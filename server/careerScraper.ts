import type { GroundedSource, RecencyWindow, TargetCompany } from '../src/types/workspace.ts';

export interface DeterministicJdSignals {
  explicitYearsFound: string[];
  minYearsRequired: number | null;
  minYearsWithMasters: number | null;
  maxYearsRequired: number | null;
  workModeHint: string | null;
  detectedMandatoryStacks: string[];
}

export interface ScrapedPosting {
  id: string;
  company: string;
  title: string;
  location: string;
  postedAtText: string;
  freshnessHours: number;
  applyUrl: string;
  fullJdText: string;
  signals: DeterministicJdSignals;
  source: GroundedSource;
  _provider: 'gh' | 'sr' | 'msft' | 'lever' | 'ashby' | 'amazon' | 'google' | 'atlassian';
  _boardSlug?: string;
  _remoteId?: string;
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
};

function decodeHtmlEntities(input: string): string {
  const decodeOnce = (str: string) =>
    str
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;|&apos;|&#x27;/gi, "'")
      .replace(/&quot;|&#34;/gi, '"')
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Run two passes to clean double-encoded Greenhouse entities (e.g. &amp;nbsp; or &amp;lt;p&amp;gt;)
  return decodeOnce(decodeOnce(input));
}

function stripHtmlPreserveLines(rawHtml: string): string {
  const decoded = decodeHtmlEntities(rawHtml);
  return decoded
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts clean plain-text JD prioritizing Responsibilities, Minimum Qualifications,
 * Preferred Qualifications, and Work Mode / Location constraints up to 5,200 chars.
 */
function extractHighSignalJd(rawText: string, maxChars = 3400): string {
  let clean = stripHtmlPreserveLines(rawText);

  // Strip trailing EEO / legal boilerplate if it appears well into the JD
  const eeoMatch = clean.match(
    /\n\s*(?:equal\s+(?:employment\s+)?opportunity|eeo\s+statement|commitment\s+to\s+diversity|accommodation\s+statement|applicant\s+privacy)\b/i
  );
  if (eeoMatch?.index && eeoMatch.index > 1100) {
    clean = clean.slice(0, eeoMatch.index).trim();
  }

  if (clean.length <= maxChars) return clean;

  const qualRegex =
    /(minimum qualifications|basic qualifications|preferred qualifications|required qualifications|what you['’]ll bring|requirements|what we['’]re looking for|who you are|your experience|skills\s*&?\s*experience|must have|qualifications|what you will do|responsibilities)/i;
  const match = qualRegex.exec(clean);

  if (match && match.index > 300) {
    const intro = clean.slice(0, 320).trim();
    const start = Math.max(320, match.index - 90);
    const body = clean.slice(start, start + (maxChars - intro.length - 12)).trim();
    return `${intro}\n...\n${body}`;
  }

  return clean.slice(0, maxChars).trim();
}

export function extractDeterministicSignals(
  cleanJdText: string,
  title: string
): DeterministicJdSignals {
  const explicitYearsFound: string[] = [];
  let minYearsRequired: number | null = null;
  let minYearsWithMasters: number | null = null;
  let maxYearsRequired: number | null = null;

  // Detect explicit Master's degree alternate YoE track (e.g. "8+ years ... OR Master's Degree ... 5+ years")
  const mastersAltRegex =
    /(\d{1,2})\s*\+?\s*years?[^\n.]{0,180}?\bOR\b[^\n.]{0,160}?\bMaster(?:'s)?\b[^\n.]{0,160}?(\d{1,2})\s*\+?\s*years?/gi;
  let mm: RegExpExecArray | null;
  while ((mm = mastersAltRegex.exec(cleanJdText)) !== null) {
    const bachelorsYrs = Number(mm[1]);
    const mastersYrs = Number(mm[2]);
    if (mastersYrs > 0 && mastersYrs < bachelorsYrs && mastersYrs <= 20) {
      minYearsWithMasters =
        minYearsWithMasters === null ? mastersYrs : Math.max(minYearsWithMasters, mastersYrs);
    }
  }

  // Also detect reverse phrasing: "Master's Degree and 5+ years ... OR Bachelor's and 8+ years"
  const mastersFirstRegex =
    /\bMaster(?:'s)?\b[^\n.]{0,140}?(\d{1,2})\s*\+?\s*years?[^\n.]{0,140}?\bOR\b[^\n.]{0,140}?(\d{1,2})\s*\+?\s*years?/gi;
  while ((mm = mastersFirstRegex.exec(cleanJdText)) !== null) {
    const mastersYrs = Number(mm[1]);
    const bachelorsYrs = Number(mm[2]);
    if (mastersYrs > 0 && mastersYrs < bachelorsYrs && mastersYrs <= 20) {
      minYearsWithMasters =
        minYearsWithMasters === null ? mastersYrs : Math.max(minYearsWithMasters, mastersYrs);
    }
  }

  // Match general phrases like "5+ years", "3-5 years", "minimum of 8 years", "at least 7 years"
  const yoeRegex =
    /(?:minimum\s+(?:of\s+)?|at\s+least\s+)?(\d{1,2})\s*(?:[-–to]+\s*(\d{1,2}))?\s*\+?\s*years?\b([^\n.]{0,90})/gi;

  let m: RegExpExecArray | null;
  while ((m = yoeRegex.exec(cleanJdText)) !== null) {
    const num1 = Number(m[1]);
    const num2 = m[2] ? Number(m[2]) : null;
    const tail = m[3] || '';
    const fullSnippet = m[0].trim();

    if (
      /\b(company|founded|history|market|warranty|retention|million|billion|customers|old|age)\b/i.test(
        fullSnippet
      )
    ) {
      continue;
    }
    if (num1 > 20 || num1 === 0) continue;

    const contextWindow = `${cleanJdText.slice(Math.max(0, m.index - 55), m.index)} ${tail}`;
    if (
      /\b(experience|software|engineering|development|coding|building|backend|frontend|systems|industry|data|ml|ai|cloud|java|python|go|c\+\+|related|relevant|role|field|degree|practical|hands[- ]on|professional)\b/i.test(
        contextWindow
      )
    ) {
      explicitYearsFound.push(fullSnippet.slice(0, 115));
      if (minYearsRequired === null || num1 > minYearsRequired) {
        minYearsRequired = num1;
      }
      if (num2 !== null && num2 <= 25 && (maxYearsRequired === null || num2 > maxYearsRequired)) {
        maxYearsRequired = num2;
      }
    }
  }

  let workModeHint: string | null = null;
  if (
    /\b(5\s*days\s*(?:a\s*week\s*)?(?:in[- ]?office|from\s*office|onsite|on[- ]?site)|100%\s*onsite|work\s*from\s*office\s*5\s*days)\b/i.test(
      cleanJdText
    )
  ) {
    workModeHint = '5 days onsite / in-office required';
  } else if (
    /\b(hybrid|3\s*days\s*(?:in[- ]?office|onsite)|2-3\s*days\s*(?:in[- ]?office|onsite)|in[- ]?office\s*presence)\b/i.test(
      cleanJdText
    )
  ) {
    workModeHint = 'Hybrid / in-office days specified';
  } else if (/\b(fully\s*remote|remote[- ]?first|100%\s*remote|all[- ]?remote)\b/i.test(cleanJdText)) {
    workModeHint = 'Remote friendly';
  }

  const combinedText = `${title}\n${cleanJdText}`;
  const detectedMandatoryStacks: string[] = [];
  const stackProbes: Array<[RegExp, string]> = [
    [
      /\b(golang|go\s+programming|fluency\s+in\s+go|proficiency\s+in\s+go|experience\s+(?:with|in)\s+go|written\s+in\s+go|services\s+in\s+go|work\s+in\s+go|include\s+go\b|go,\s*(?:java|python|c\+\+|rust|node|typescript)|(?:java|python|c\+\+|rust),?\s+go\b)\b/i,
      'Go (Golang)',
    ],
    [/\b(rust\s+programming|experience\s+(?:with|in)\s+rust|written\s+in\s+rust|fluency\s+in\s+rust)\b/i, 'Rust'],
    [/\b(kubernetes|k8s)\b/i, 'Kubernetes'],
    [/\b(kafka|flink|spark|airflow)\b/i, 'Kafka / Streaming / Spark'],
    [/\b(aws|amazon web services)\b/i, 'AWS'],
    [/\b(azure)\b/i, 'Microsoft Azure'],
    [/\b(terraform|ansible|helm)\b/i, 'Terraform / IaC'],
    [/\b(c#|dotnet|\.net)\b/i, 'C# / .NET'],
    [/\b(ruby\s+on\s+rails|ruby)\b/i, 'Ruby'],
    [/\b(typescript|react|next\.?js|angular|vue)\b/i, 'TypeScript / Frontend'],
    [/\b(ios|swift|android|kotlin)\b/i, 'Mobile (iOS / Android)'],
    [/\b(pytorch|tensorflow|cuda|deep learning)\b/i, 'PyTorch / Deep Learning'],
  ];
  for (const [rx, label] of stackProbes) {
    if (rx.test(combinedText)) detectedMandatoryStacks.push(label);
  }

  return {
    explicitYearsFound: Array.from(new Set(explicitYearsFound)).slice(0, 6),
    minYearsRequired,
    minYearsWithMasters,
    maxYearsRequired,
    workModeHint,
    detectedMandatoryStacks,
  };
}

function isIndiaLocation(text: string): boolean {
  return /\b(india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|chennai|mumbai|kolkata|remote\s*-\s*india|in-)\b/i.test(
    text
  );
}

function isMidLevelSweTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const excluded =
    /\b(intern|internship|university|new grad|graduate|campus|apprentice|staff|principal|distinguished|fellow|director|vp|vice president|head of|engineering manager|senior manager|manager|sales|account executive|recruiter|talent|counsel|legal|marketing|designer|product manager|technical writer|support|solutions architect|auditor|finance|analyst|sap|phd|courseware|solutions consultant|customer engineer|field engineer|administrator|business systems|demo engineering|cloud operations|operations engineer|release engineer|qa |quality assurance|developer advocate|evangelist|pre-?sales|network engineer|security analyst|sme|specialist)\b/i;
  if (excluded.test(lower)) return false;

  const isEng =
    /\b(software|backend|back-end|platform|distributed|systems|cloud|full.?stack|sde|swe|developer|api|infrastructure|data engineer|ai engineer|ml engineer|machine learning|site reliability|sre)\b/i.test(
      lower
    );
  if (!isEng) return false;

  if (/\b(senior staff|sr\.? staff|architect|chief|iii|iv|l6|l7)\b/i.test(lower)) return false;
  return true;
}

function hoursAgoFromIso(dateStr: string | number | undefined): {
  hours: number;
  label: string;
} {
  if (!dateStr) {
    return { hours: 96, label: 'Recently posted' };
  }
  let ms = 0;
  if (typeof dateStr === 'number') {
    ms = dateStr > 1e12 ? dateStr : dateStr * 1000;
  } else {
    ms = Date.parse(dateStr);
  }
  if (!Number.isFinite(ms) || ms <= 0) {
    return { hours: 96, label: 'Recently posted' };
  }
  const diffHours = Math.max(1, Math.round((Date.now() - ms) / (1000 * 60 * 60)));
  if (diffHours < 24) return { hours: diffHours, label: `${diffHours}h ago` };
  const days = Math.round(diffHours / 24);
  if (days === 1) return { hours: diffHours, label: '1d ago' };
  if (days <= 30) return { hours: diffHours, label: `${days}d ago` };
  return { hours: diffHours, label: `${Math.round(days / 30)}mo ago` };
}

async function fetchJsonSafe<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const GREENHOUSE_BOARDS: Record<string, string> = {
  stripe: 'stripe',
  databricks: 'databricks',
  rubrik: 'rubrik',
  coinbase: 'coinbase',
  cloudflare: 'cloudflare',
  mongodb: 'mongodb',
  gitlab: 'gitlab',
  razorpay: 'razorpaysoftwareprivatelimited',
  okta: 'okta',
  zscaler: 'zscaler',
  'pure storage': 'purestorage',
  celonis: 'celonis',
  netskope: 'netskope',
  toast: 'toast',
  elastic: 'elastic',
  fivetran: 'fivetran',
  'sumo logic': 'sumologic',
  twilio: 'twilio',
  airbnb: 'airbnb',
  druva: 'druva',
  agoda: 'agoda',
  datadog: 'datadog',
  commerceiq: 'commerceiq',
  groww: 'groww',
  coupang: 'coupang',
  anthropic: 'anthropic',
  starburst: 'starburst',
  neo4j: 'neo4j',
  singlestore: 'singlestore',
  yugabyte: 'yugabyte',
  'together ai': 'togetherai',
  mixpanel: 'mixpanel',
  launchdarkly: 'launchdarkly',
  samsara: 'samsara',
  tenstorrent: 'tenstorrent',
  'new relic': 'newrelic',
  fastly: 'fastly',
  figma: 'figma',
  'grafana labs': 'grafanalabs',
  adyen: 'adyen',
  'cockroach labs': 'cockroachlabs',
  duolingo: 'duolingo',
  'scale ai': 'scaleai',
};

export const LEVER_BOARDS: Record<string, string> = {
  cred: 'cred',
  meesho: 'meesho',
  mindtickle: 'mindtickle',
};

export const ASHBY_BOARDS: Record<string, string> = {
  snowflake: 'snowflake',
  openai: 'openai',
  cursor: 'cursor',
  notion: 'notion',
  temporal: 'temporal',
};

export const SMARTRECRUITERS_BOARDS: Record<string, string> = {
  servicenow: 'ServiceNow',
  swiggy: 'Swiggy',
  freshworks: 'Freshworks',
  whatfix: 'Whatfix',
};

const EMPTY_SIGNALS: DeterministicJdSignals = {
  explicitYearsFound: [],
  minYearsRequired: null,
  minYearsWithMasters: null,
  maxYearsRequired: null,
  workModeHint: null,
  detectedMandatoryStacks: [],
};

async function fetchGreenhouseBoard(
  companyName: string,
  boardSlug: string
): Promise<ScrapedPosting[]> {
  interface GhJob {
    id: number;
    title: string;
    absolute_url: string;
    updated_at?: string;
    location?: { name?: string };
  }
  const data = await fetchJsonSafe<{ jobs?: GhJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${boardSlug}/jobs`
  );
  if (!data?.jobs) return [];

  return data.jobs
    .filter((j) => isIndiaLocation(j.location?.name || '') && isMidLevelSweTitle(j.title))
    .map((j) => {
      const { hours, label } = hoursAgoFromIso(j.updated_at);
      return {
        id: `gh-${boardSlug}-${j.id}`,
        company: companyName,
        title: j.title,
        location: j.location?.name || 'Bengaluru, India',
        postedAtText: label,
        freshnessHours: hours,
        applyUrl: j.absolute_url,
        fullJdText: '',
        signals: EMPTY_SIGNALS,
        source: { title: `${companyName} Greenhouse Careers`, url: j.absolute_url },
        _provider: 'gh',
        _boardSlug: boardSlug,
        _remoteId: String(j.id),
      };
    });
}

async function fetchLeverBoard(
  companyName: string,
  boardSlug: string
): Promise<ScrapedPosting[]> {
  interface LeverJob {
    id: string;
    text: string;
    hostedUrl: string;
    createdAt?: number;
    categories?: { location?: string; team?: string };
    descriptionPlain?: string;
    additionalPlain?: string;
    lists?: Array<{ text?: string; content?: string }>;
  }
  const data = await fetchJsonSafe<LeverJob[]>(
    `https://api.lever.co/v0/postings/${boardSlug}?mode=json`
  );
  if (!Array.isArray(data)) return [];

  return data
    .filter(
      (j) =>
        isIndiaLocation(j.categories?.location || 'India') && isMidLevelSweTitle(j.text)
    )
    .map((j) => {
      const { hours, label } = hoursAgoFromIso(j.createdAt);
      const listsText = (j.lists || [])
        .map((l) => `${l.text || ''}\n${stripHtmlPreserveLines(l.content || '')}`)
        .join('\n\n');
      const combined = [j.descriptionPlain, listsText, j.additionalPlain]
        .filter(Boolean)
        .join('\n\n');
      const fullJdText = extractHighSignalJd(combined);
      return {
        id: `lever-${boardSlug}-${j.id}`,
        company: companyName,
        title: j.text,
        location: j.categories?.location || 'Bengaluru, India',
        postedAtText: label,
        freshnessHours: hours,
        applyUrl: j.hostedUrl,
        fullJdText,
        signals: extractDeterministicSignals(fullJdText, j.text),
        source: { title: `${companyName} Lever Careers`, url: j.hostedUrl },
        _provider: 'lever',
      };
    });
}

async function fetchAshbyBoard(
  companyName: string,
  boardSlug: string
): Promise<ScrapedPosting[]> {
  interface AshbyJob {
    id: string;
    title: string;
    location?: string;
    publishedAt?: string;
    jobUrl: string;
    descriptionPlain?: string;
    descriptionHtml?: string;
  }
  const data = await fetchJsonSafe<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${boardSlug}`
  );
  if (!data?.jobs) return [];

  return data.jobs
    .filter((j) => isIndiaLocation(j.location || '') && isMidLevelSweTitle(j.title))
    .map((j) => {
      const { hours, label } = hoursAgoFromIso(j.publishedAt);
      const raw = j.descriptionPlain || j.descriptionHtml || '';
      const fullJdText = extractHighSignalJd(raw);
      return {
        id: `ashby-${boardSlug}-${j.id}`,
        company: companyName,
        title: j.title,
        location: j.location || 'Bengaluru / Pune, India',
        postedAtText: label,
        freshnessHours: hours,
        applyUrl: j.jobUrl,
        fullJdText,
        signals: extractDeterministicSignals(fullJdText, j.title),
        source: { title: `${companyName} Ashby Careers`, url: j.jobUrl },
        _provider: 'ashby',
      };
    });
}

async function fetchSmartRecruitersBoard(
  companyName: string,
  companySlug: string
): Promise<ScrapedPosting[]> {
  interface SrJob {
    id: string;
    name: string;
    releasedDate?: string;
    location?: { city?: string; country?: string };
  }
  const data = await fetchJsonSafe<{ content?: SrJob[] }>(
    `https://api.smartrecruiters.com/v1/companies/${companySlug}/postings?limit=40&country=in`
  );
  if (!Array.isArray(data?.content)) return [];

  return data.content
    .filter((j) => isMidLevelSweTitle(j.name))
    .map((j) => {
      const { hours, label } = hoursAgoFromIso(j.releasedDate);
      const url = `https://jobs.smartrecruiters.com/${companySlug}/${j.id}`;
      const loc = j.location?.city ? `${j.location.city}, India` : 'India';
      return {
        id: `sr-${companySlug}-${j.id}`,
        company: companyName,
        title: j.name,
        location: loc,
        postedAtText: label,
        freshnessHours: hours,
        applyUrl: url,
        fullJdText: '',
        signals: EMPTY_SIGNALS,
        source: { title: `${companyName} SmartRecruiters`, url },
        _provider: 'sr',
        _boardSlug: companySlug,
        _remoteId: j.id,
      };
    });
}

async function fetchAtlassian(): Promise<ScrapedPosting[]> {
  interface AtlassianJob {
    id: number;
    title: string;
    locations?: string[];
    overview?: string;
    responsibilities?: string;
    qualifications?: string;
    portalJobPost?: { portalUrl?: string; updatedDate?: string };
  }
  const data = await fetchJsonSafe<AtlassianJob[]>(
    'https://www.atlassian.com/endpoint/careers/listings'
  );
  if (!Array.isArray(data)) return [];

  return data
    .filter((j) => isIndiaLocation((j.locations || []).join(' ')) && isMidLevelSweTitle(j.title))
    .map((j) => {
      const { hours, label } = hoursAgoFromIso(j.portalJobPost?.updatedDate);
      const url =
        j.portalJobPost?.portalUrl || 'https://www.atlassian.com/company/careers/all-jobs';
      const combined = [
        j.overview ? `Overview:\n${j.overview}` : '',
        j.responsibilities ? `Responsibilities:\n${j.responsibilities}` : '',
        j.qualifications ? `Qualifications:\n${j.qualifications}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const fullJdText = extractHighSignalJd(combined);
      return {
        id: `atlassian-${j.id}`,
        company: 'Atlassian',
        title: j.title,
        location: (j.locations || []).find((l) => isIndiaLocation(l)) || 'Bengaluru / Remote India',
        postedAtText: label,
        freshnessHours: hours,
        applyUrl: url,
        fullJdText,
        signals: extractDeterministicSignals(fullJdText, j.title),
        source: { title: 'Atlassian Careers', url },
        _provider: 'atlassian',
      };
    });
}

async function fetchAmazon(): Promise<ScrapedPosting[]> {
  interface AmazonJob {
    id_icims: string;
    title: string;
    normalized_location?: string;
    posted_date?: string;
    job_path: string;
    basic_qualifications?: string;
    preferred_qualifications?: string;
    description?: string;
    description_short?: string;
  }
  const data = await fetchJsonSafe<{ jobs?: AmazonJob[] }>(
    'https://www.amazon.jobs/en/search.json?base_query=Software+Development+Engineer&country=IND&result_limit=25&sort=recent'
  );
  if (!data?.jobs) return [];

  return data.jobs
    .filter((j) => isMidLevelSweTitle(j.title))
    .map((j) => {
      const { hours, label } = hoursAgoFromIso(j.posted_date);
      const url = `https://www.amazon.jobs${j.job_path}`;
      const combined = [
        j.description || j.description_short ? `Description:\n${j.description || j.description_short}` : '',
        j.basic_qualifications ? `Minimum / Basic Qualifications:\n${j.basic_qualifications}` : '',
        j.preferred_qualifications ? `Preferred Qualifications:\n${j.preferred_qualifications}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const fullJdText = extractHighSignalJd(combined);
      return {
        id: `amazon-${j.id_icims}`,
        company: 'Amazon',
        title: j.title,
        location: j.normalized_location || 'Bengaluru / Hyderabad, India',
        postedAtText: label,
        freshnessHours: hours,
        applyUrl: url,
        fullJdText,
        signals: extractDeterministicSignals(fullJdText, j.title),
        source: { title: 'Amazon Jobs India', url },
        _provider: 'amazon',
      };
    });
}

async function fetchMicrosoft(): Promise<ScrapedPosting[]> {
  interface MsftPos {
    id: number;
    name: string;
    locations?: string[];
    postedTs?: number;
  }
  const data = await fetchJsonSafe<{ data?: { positions?: MsftPos[] } }>(
    'https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=Software%20Engineer&location=India&start=0&sort_by=timestamp'
  );
  const positions = data?.data?.positions;
  if (!Array.isArray(positions)) return [];

  return positions
    .filter((p) => isIndiaLocation((p.locations || []).join(' ')) && isMidLevelSweTitle(p.name))
    .map((p) => {
      const { hours, label } = hoursAgoFromIso(p.postedTs);
      const url = `https://apply.careers.microsoft.com/careers/job/${p.id}`;
      return {
        id: `msft-${p.id}`,
        company: 'Microsoft',
        title: p.name,
        location: (p.locations || [])[0] || 'Hyderabad / Bengaluru, India',
        postedAtText: label,
        freshnessHours: hours,
        applyUrl: url,
        fullJdText: '',
        signals: EMPTY_SIGNALS,
        source: { title: 'Microsoft Careers India', url },
        _provider: 'msft',
        _remoteId: String(p.id),
      };
    });
}

async function fetchGoogle(): Promise<ScrapedPosting[]> {
  try {
    const res = await fetch(
      'https://www.google.com/about/careers/applications/jobs/results/?location=India&q=Software%20Engineer',
      { headers: HEADERS, signal: AbortSignal.timeout(9000) }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const ds = html.match(
      /AF_initDataCallback\(\{key:\s*'ds:1'[\s\S]*?data:([\s\S]*?),\s*sideChannel:/
    );
    if (!ds?.[1]) return [];
    const parsed = JSON.parse(ds[1]) as unknown[][];
    const items = Array.isArray(parsed?.[0]) ? (parsed[0] as unknown[][]) : [];

    const results: ScrapedPosting[] = [];
    for (const item of items) {
      const jobId = String(item[0] ?? '');
      const title = String(item[1] ?? '');
      if (!jobId || !title || !isMidLevelSweTitle(title)) continue;

      const locsRaw = Array.isArray(item[9]) ? (item[9] as unknown[][]) : [];
      const firstLoc = String(locsRaw[0]?.[0] ?? 'Bengaluru / Hyderabad, India');
      const respHtml = Array.isArray(item[3]) ? String(item[3][1] ?? '') : '';
      const qualHtml = Array.isArray(item[4]) ? String(item[4][1] ?? '') : '';
      const combined = [
        qualHtml ? `Minimum & Preferred Qualifications:\n${qualHtml}` : '',
        respHtml ? `Responsibilities:\n${respHtml}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const fullJdText = extractHighSignalJd(combined);
      const url = `https://www.google.com/about/careers/applications/jobs/results/${jobId}`;

      results.push({
        id: `google-${jobId}`,
        company: 'Google',
        title,
        location: firstLoc,
        postedAtText: 'Active on Google Careers',
        freshnessHours: 36,
        applyUrl: url,
        fullJdText,
        signals: extractDeterministicSignals(fullJdText, title),
        source: { title: 'Google Careers India', url },
        _provider: 'google',
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function hydrateFullJobDetails(posts: ScrapedPosting[]): Promise<void> {
  await Promise.all(
    posts.map(async (post) => {
      if (post._provider === 'gh' && post._boardSlug && post._remoteId) {
        const detail = await fetchJsonSafe<{ content?: string }>(
          `https://boards-api.greenhouse.io/v1/boards/${post._boardSlug}/jobs/${post._remoteId}`,
          6000
        );
        if (detail?.content) {
          post.fullJdText = extractHighSignalJd(detail.content);
          post.signals = extractDeterministicSignals(post.fullJdText, post.title);
        }
      } else if (post._provider === 'sr' && post._boardSlug && post._remoteId) {
        interface SrDetail {
          jobAd?: {
            sections?: {
              jobDescription?: { text?: string };
              qualifications?: { text?: string };
              additionalInformation?: { text?: string };
            };
          };
        }
        const detail = await fetchJsonSafe<SrDetail>(
          `https://api.smartrecruiters.com/v1/companies/${post._boardSlug}/postings/${post._remoteId}`,
          6000
        );
        const sections = detail?.jobAd?.sections;
        if (sections) {
          const combined = [
            sections.qualifications?.text
              ? `Qualifications:\n${sections.qualifications.text}`
              : '',
            sections.jobDescription?.text
              ? `Description:\n${sections.jobDescription.text}`
              : '',
            sections.additionalInformation?.text
              ? `Additional:\n${sections.additionalInformation.text}`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          post.fullJdText = extractHighSignalJd(combined);
          post.signals = extractDeterministicSignals(post.fullJdText, post.title);
        }
      } else if (post._provider === 'msft' && post._remoteId) {
        const detail = await fetchJsonSafe<{ data?: { jobDescription?: string } }>(
          `https://apply.careers.microsoft.com/api/pcsx/position_details?position_id=${post._remoteId}&domain=microsoft.com`,
          6000
        );
        if (detail?.data?.jobDescription) {
          post.fullJdText = extractHighSignalJd(detail.data.jobDescription);
          post.signals = extractDeterministicSignals(post.fullJdText, post.title);
        }
      }
    })
  );
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

function isSeniorTitle(title: string): boolean {
  return /\b(senior|sr\.?|lead)\b/i.test(title);
}

export async function scrapeLiveCareerPortals(
  companies: TargetCompany[],
  recencyWindow: RecencyWindow,
  roleFocus: string
): Promise<ScrapedPosting[]> {
  void roleFocus;

  const allBatches = await runWithConcurrency(companies, 14, async (company) => {
    const key = company.name.toLowerCase().trim();
    if (key === 'google') return fetchGoogle();
    if (key === 'microsoft') return fetchMicrosoft();
    if (key === 'amazon') return fetchAmazon();
    if (key === 'atlassian') return fetchAtlassian();
    if (GREENHOUSE_BOARDS[key]) return fetchGreenhouseBoard(company.name, GREENHOUSE_BOARDS[key]);
    if (LEVER_BOARDS[key]) return fetchLeverBoard(company.name, LEVER_BOARDS[key]);
    if (ASHBY_BOARDS[key]) return fetchAshbyBoard(company.name, ASHBY_BOARDS[key]);
    if (SMARTRECRUITERS_BOARDS[key]) {
      return fetchSmartRecruitersBoard(company.name, SMARTRECRUITERS_BOARDS[key]);
    }

    const domainLower = company.careersDomain.toLowerCase();
    const ghMatch = domainLower.match(/greenhouse\.io\/(?:v1\/boards\/)?([a-z0-9_-]+)/);
    if (ghMatch?.[1]) return fetchGreenhouseBoard(company.name, ghMatch[1]);

    const leverMatch = domainLower.match(/lever\.co\/([a-z0-9_-]+)/);
    if (leverMatch?.[1]) return fetchLeverBoard(company.name, leverMatch[1]);

    const ashbyMatch = domainLower.match(/ashbyhq\.com\/([a-z0-9_-]+)/);
    if (ashbyMatch?.[1]) return fetchAshbyBoard(company.name, ashbyMatch[1]);

    return [];
  });

  const flat = allBatches.flat();
  // Prefer non-Senior mid-level titles first, then freshness
  flat.sort((a, b) => {
    const seniorDiff = Number(isSeniorTitle(a.title)) - Number(isSeniorTitle(b.title));
    if (seniorDiff !== 0) return seniorDiff;
    return a.freshnessHours - b.freshnessHours;
  });

  const maxHours = recencyWindow === '24h' ? 48 : recencyWindow === '72h' ? 120 : 336;
  const freshOnly = flat.filter((j) => j.freshnessHours <= maxHours);
  const pool = freshOnly.length >= 10 ? freshOnly : flat;

  // Diversify: Pass 1 picks 1 role per distinct company; Pass 2 fills up to 2 per company (26 total to inspect full JDs)
  const candidates: ScrapedPosting[] = [];
  const usedIds = new Set<string>();
  const perCompanyCount = new Map<string, number>();

  for (const passCap of [1, 2]) {
    for (const job of pool) {
      if (usedIds.has(job.id)) continue;
      const count = perCompanyCount.get(job.company) ?? 0;
      if (count >= passCap) continue;
      perCompanyCount.set(job.company, count + 1);
      usedIds.add(job.id);
      candidates.push(job);
      if (candidates.length >= 26) break;
    }
    if (candidates.length >= 26) break;
  }

  await hydrateFullJobDetails(candidates);
  const hydrated = candidates.filter((j) => j.fullJdText.trim().length > 100);

  // Enforce Mid-Level YoE compatibility: filter out roles explicitly requiring 7+ YoE (even accounting for Master's degree)
  const midLevelCompatible = hydrated.filter((j) => {
    const effectiveMin = j.signals.minYearsWithMasters ?? j.signals.minYearsRequired;
    if (effectiveMin !== null && effectiveMin >= 7) return false;
    return true;
  });

  const finalPool = midLevelCompatible.length >= 5 ? midLevelCompatible : hydrated;
  return finalPool.slice(0, 8);
}
