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
  _provider:
    | 'gh'
    | 'sr'
    | 'msft'
    | 'lever'
    | 'ashby'
    | 'amazon'
    | 'google'
    | 'atlassian'
    | 'adobe'
    | 'linkedin';
  _boardSlug?: string;
  _remoteId?: string;
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const WORD_TO_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseYearToken(raw: string | undefined): number | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower in WORD_TO_NUM) return WORD_TO_NUM[lower];
  const n = Number(lower);
  return Number.isFinite(n) ? n : null;
}

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

  return decodeOnce(decodeOnce(input));
}

function stripHtmlPreserveLines(rawHtml: string): string {
  const decoded = decodeHtmlEntities(rawHtml);
  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHighSignalJd(rawText: string, maxChars = 3400): string {
  let clean = stripHtmlPreserveLines(rawText);

  const eeoMatch = clean.match(
    /\n\s*(?:equal\s+(?:employment\s+)?opportunity|eeo\s+statement|commitment\s+to\s+diversity|accommodation\s+statement|applicant\s+privacy)\b/i
  );
  if (eeoMatch?.index && eeoMatch.index > 900) {
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

function splitPreferredSection(cleanJdText: string): {
  coreText: string;
  preferredText: string;
} {
  const prefMatch = cleanJdText.match(
    /(?:^|\n)\s*(?:preferred\s+qualifications|nice\s+to\s+have|bonus\s+(?:points|qualifications|skills)|desired\s+qualifications|preferred\s+skills|good\s+to\s+have)\s*:?/i
  );
  if (prefMatch?.index && prefMatch.index > 180) {
    return {
      coreText: cleanJdText.slice(0, prefMatch.index),
      preferredText: cleanJdText.slice(prefMatch.index),
    };
  }
  return { coreText: cleanJdText, preferredText: '' };
}

export function extractDeterministicSignals(
  cleanJdText: string,
  title: string
): DeterministicJdSignals {
  const explicitYearsFound: string[] = [];
  let minYearsRequired: number | null = null;
  let minYearsWithMasters: number | null = null;
  let maxYearsRequired: number | null = null;

  const { coreText } = splitPreferredSection(cleanJdText);

  const numToken = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';

  // Detect explicit Master's degree alternate YoE track in core/minimum qualifications
  const mastersAltRegex = new RegExp(
    `${numToken}\\s*\\+?\\s*years?[^\\n.]{0,180}?\\bOR\\b[^\\n.]{0,160}?\\bMaster(?:'s)?\\b[^\\n.]{0,160}?${numToken}\\s*\\+?\\s*years?`,
    'gi'
  );
  let mm: RegExpExecArray | null;
  while ((mm = mastersAltRegex.exec(coreText)) !== null) {
    const bachelorsYrs = parseYearToken(mm[1]);
    const mastersYrs = parseYearToken(mm[2]);
    if (bachelorsYrs && mastersYrs && mastersYrs > 0 && mastersYrs < bachelorsYrs && mastersYrs <= 20) {
      minYearsWithMasters =
        minYearsWithMasters === null ? mastersYrs : Math.max(minYearsWithMasters, mastersYrs);
    }
  }

  const mastersFirstRegex = new RegExp(
    `\\bMaster(?:'s)?\\b[^\\n.]{0,140}?${numToken}\\s*\\+?\\s*years?[^\\n.]{0,140}?\\bOR\\b[^\\n.]{0,140}?${numToken}\\s*\\+?\\s*years?`,
    'gi'
  );
  while ((mm = mastersFirstRegex.exec(coreText)) !== null) {
    const mastersYrs = parseYearToken(mm[1]);
    const bachelorsYrs = parseYearToken(mm[2]);
    if (bachelorsYrs && mastersYrs && mastersYrs > 0 && mastersYrs < bachelorsYrs && mastersYrs <= 20) {
      minYearsWithMasters =
        minYearsWithMasters === null ? mastersYrs : Math.max(minYearsWithMasters, mastersYrs);
    }
  }

  const yoeRegex = new RegExp(
    `(?:minimum\\s+(?:of\\s+)?|at\\s+least\\s+)?${numToken}\\s*(?:[-–to]+\\s*${numToken})?\\s*\\+?\\s*years?\\b([^\\n.]{0,90})`,
    'gi'
  );

  // 1) Extract minimum YoE strictly from non-preferred / core requirements
  let m: RegExpExecArray | null;
  while ((m = yoeRegex.exec(coreText)) !== null) {
    const num1 = parseYearToken(m[1]);
    const num2 = parseYearToken(m[2]);
    const tail = m[3] || '';
    const fullSnippet = m[0].trim();

    if (
      !num1 ||
      num1 > 20 ||
      /\b(company|founded|history|market|warranty|retention|million|billion|customers|old|age)\b/i.test(
        fullSnippet
      )
    ) {
      continue;
    }

    const contextWindow = `${coreText.slice(Math.max(0, m.index - 55), m.index)} ${tail}`;
    if (
      /\b(experience|software|engineering|development|coding|building|backend|frontend|systems|industry|data|ml|ai|cloud|java|python|go|c\+\+|related|relevant|role|field|degree|practical|hands[- ]on|professional|work|programming|technical)\b/i.test(
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

  // 2) Also record any YoE mentions across the entire JD for Gemini Judge visibility
  const fullYoeRegex = new RegExp(yoeRegex.source, 'gi');
  while ((m = fullYoeRegex.exec(cleanJdText)) !== null) {
    const num1 = parseYearToken(m[1]);
    const tail = m[3] || '';
    const fullSnippet = m[0].trim();
    if (
      !num1 ||
      num1 > 20 ||
      /\b(company|founded|history|market|warranty|retention|million|billion|customers|old|age)\b/i.test(
        fullSnippet
      )
    ) {
      continue;
    }
    const contextWindow = `${cleanJdText.slice(Math.max(0, m.index - 55), m.index)} ${tail}`;
    if (
      /\b(experience|software|engineering|development|coding|building|backend|frontend|systems|industry|data|ml|ai|cloud|java|python|go|c\+\+|related|relevant|role|field|degree|practical|hands[- ]on|professional|work|programming|technical)\b/i.test(
        contextWindow
      )
    ) {
      explicitYearsFound.push(fullSnippet.slice(0, 115));
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
    [/\b(spring\s*boot|spring\s*framework|spring\s*mvc)\b/i, 'Spring Boot'],
    [/\bjava\b(?!script)/i, 'Java (Industry)'],
    [/\b(rust\s+programming|experience\s+(?:with|in)\s+rust|written\s+in\s+rust|fluency\s+in\s+rust)\b/i, 'Rust'],
    [/\b(kafka|flink|spark|airflow)\b/i, 'Kafka / Streaming / Spark'],
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

  // Flag AWS or Azure ONLY if explicitly required in core (non-preferred) qualifications without GCP multi-cloud equivalence
  const coreLines = coreText.split(/\n+/);
  for (const line of coreLines) {
    const hasGcpAlt = /\b(gcp|google\s+cloud)\b/i.test(line);
    if (!hasGcpAlt && /\b(aws|amazon\s+web\s+services)\b/i.test(line)) {
      if (!detectedMandatoryStacks.includes('AWS (Primary)')) {
        detectedMandatoryStacks.push('AWS (Primary)');
      }
    }
    if (!hasGcpAlt && /\b(microsoft\s+azure|azure)\b/i.test(line)) {
      if (!detectedMandatoryStacks.includes('Microsoft Azure (Primary)')) {
        detectedMandatoryStacks.push('Microsoft Azure (Primary)');
      }
    }
  }

  return {
    explicitYearsFound: Array.from(new Set(explicitYearsFound)).slice(0, 8),
    minYearsRequired,
    minYearsWithMasters,
    maxYearsRequired,
    workModeHint,
    detectedMandatoryStacks,
  };
}

function isIndiaLocation(text: string): boolean {
  return /\b(india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|chennai|mumbai|kolkata|remote\s*-\s*india|in-|ind)\b/i.test(
    text
  );
}

export function isMidLevelSweTitle(title: string): boolean {
  const lower = title.toLowerCase();

  // Exclude clearly non-engineering, intern/campus, and Principal+/Director+/Staff-Engineer+ roles.
  // Note: DO NOT exclude standalone "staff" because "Member of Technical Staff" (MTS/SMTS) contains "staff".
  const excluded =
    /\b(intern|internship|university|new grad|graduate|campus|apprentice|principal|distinguished|fellow|director|vp|vice president|head of|engineering manager|senior manager|manager|sales|account executive|recruiter|talent|counsel|legal|marketing|designer|product manager|technical writer|support|solutions architect|auditor|finance|analyst|sap|phd|courseware|solutions consultant|customer engineer|field engineer|administrator|business systems|demo engineering|cloud operations|operations engineer|release engineer|qa\b|quality assurance|developer advocate|evangelist|pre-?sales|network engineer|security analyst|sme|specialist|senior staff|sr\.? staff|staff\s+(?:software|backend|frontend|systems|cloud|platform|data|ml|ai|security|sre|engineer|developer)|architect|chief)\b/i;
  if (excluded.test(lower)) return false;

  // Exclude explicit extreme level bands (L6/L7/IV/SDE-4/MTS-4/CS-3+)
  if (/\b(sde[- ]?(?:iv|4)|swe[- ]?(?:iv|4)|engineer\s*(?:iv|4)|mts[- ]?4|computer scientist\s*(?:iii|3|iv|4)|l6|l7)\b/i.test(lower)) {
    return false;
  }

  const isEng =
    /\b(software|backend|back-end|platform|distributed|systems|cloud|full.?stack|frontend|front-end|sde|swe|developer|api|infrastructure|data engineer|ai engineer|ml engineer|machine learning|mlops|devops|security engineer|product engineer|founding engineer|site reliability|sre|computer scientist|member of technical staff|mts|smts|applied scientist|research scientist|research engineer)\b/i.test(
      lower
    );
  return isEng;
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

async function fetchJsonSafe<T>(url: string, timeoutMs = 8500): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

async function fetchTextSafe(url: string, timeoutMs = 8500): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export const LINKEDIN_COMPANY_IDS: Record<string, string> = {
  meta: '10667',
  uber: '1815218',
  netflix: '165158',
  linkedin: '1337',
  intuit: '1666',
  adobe: '1480',
  'walmart global tech': '2646',
  paypal: '1482',
  salesforce: '3185',
  flipkart: '321062',
  nvidia: '3608',
  visa: '2190',
};

const LINKEDIN_SUBTITLE_TOKENS: Record<string, string[]> = {
  phonepe: ['phonepe'],
  postman: ['postman'],
  browserstack: ['browserstack'],
  confluent: ['confluent'],
  nutanix: ['nutanix'],
  cohesity: ['cohesity'],
  crowdstrike: ['crowdstrike'],
  'palo alto networks': ['palo alto'],
  'arista networks': ['arista'],
  'american express': ['american express'],
  rippling: ['rippling'],
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
  const seen = new Set<string>();
  const results: ScrapedPosting[] = [];

  for (const offset of [0, 100]) {
    const data = await fetchJsonSafe<{ content?: SrJob[] }>(
      `https://api.smartrecruiters.com/v1/companies/${companySlug}/postings?limit=100&offset=${offset}&country=in`
    );
    const page = data?.content;
    if (!Array.isArray(page) || page.length === 0) break;

    for (const j of page) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      if (!isMidLevelSweTitle(j.name)) continue;
      const { hours, label } = hoursAgoFromIso(j.releasedDate);
      const url = `https://jobs.smartrecruiters.com/${companySlug}/${j.id}`;
      const loc = j.location?.city ? `${j.location.city}, India` : 'India';
      results.push({
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
      });
    }

    if (page.length < 100) break;
  }

  return results;
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

  const queries = [
    { q: 'Software+Development+Engineer', offsets: [0, 25, 50] },
    { q: 'Software+Engineer', offsets: [0, 25] },
    { q: 'Applied+Scientist', offsets: [0] },
  ];

  const seen = new Set<string>();
  const results: ScrapedPosting[] = [];

  for (const { q, offsets } of queries) {
    for (const offset of offsets) {
      const data = await fetchJsonSafe<{ jobs?: AmazonJob[] }>(
        `https://www.amazon.jobs/en/search.json?base_query=${q}&country=IND&result_limit=25&offset=${offset}&sort=recent`
      );
      const jobs = data?.jobs;
      if (!Array.isArray(jobs) || jobs.length === 0) break;

      for (const j of jobs) {
        if (!j.id_icims || seen.has(j.id_icims)) continue;
        seen.add(j.id_icims);
        if (!isMidLevelSweTitle(j.title)) continue;

        const { hours, label } = hoursAgoFromIso(j.posted_date);
        const url = `https://www.amazon.jobs${j.job_path}`;
        const combined = [
          j.description || j.description_short
            ? `Description:\n${j.description || j.description_short}`
            : '',
          j.basic_qualifications ? `Minimum / Basic Qualifications:\n${j.basic_qualifications}` : '',
          j.preferred_qualifications
            ? `Preferred Qualifications:\n${j.preferred_qualifications}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        const fullJdText = extractHighSignalJd(combined);
        results.push({
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
        });
      }
      if (jobs.length < 25) break;
    }
  }

  return results;
}

async function fetchMicrosoft(): Promise<ScrapedPosting[]> {
  interface MsftPos {
    id: number;
    name: string;
    locations?: string[];
    postedTs?: number;
  }

  const queries = [
    { q: 'Software%20Engineer', starts: [0, 20, 40] },
    { q: 'Engineer', starts: [0, 20] },
  ];

  const seen = new Set<number>();
  const results: ScrapedPosting[] = [];

  for (const { q, starts } of queries) {
    for (const start of starts) {
      const data = await fetchJsonSafe<{ data?: { positions?: MsftPos[] } }>(
        `https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=${q}&location=India&start=${start}&sort_by=timestamp`
      );
      const positions = data?.data?.positions;
      if (!Array.isArray(positions) || positions.length === 0) break;

      for (const p of positions) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        if (!isIndiaLocation((p.locations || []).join(' ')) || !isMidLevelSweTitle(p.name)) continue;

        const { hours, label } = hoursAgoFromIso(p.postedTs);
        const url = `https://apply.careers.microsoft.com/careers/job/${p.id}`;
        results.push({
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
        });
      }
      if (positions.length < 15) break;
    }
  }

  return results;
}

async function fetchGoogle(): Promise<ScrapedPosting[]> {
  const queries = ['Software%20Engineer', 'Systems%20Engineer', 'Engineering'];
  const seen = new Set<string>();
  const results: ScrapedPosting[] = [];

  for (const q of queries) {
    const html = await fetchTextSafe(
      `https://www.google.com/about/careers/applications/jobs/results/?location=India&q=${q}`,
      9000
    );
    if (!html) continue;

    const ds = html.match(
      /AF_initDataCallback\(\{key:\s*'ds:1'[\s\S]*?data:([\s\S]*?),\s*sideChannel:/
    );
    if (!ds?.[1]) continue;

    try {
      const parsed = JSON.parse(ds[1]) as unknown[][];
      const items = Array.isArray(parsed?.[0]) ? (parsed[0] as unknown[][]) : [];

      for (const item of items) {
        const jobId = String(item[0] ?? '');
        const title = String(item[1] ?? '');
        if (!jobId || seen.has(jobId) || !title || !isMidLevelSweTitle(title)) continue;
        seen.add(jobId);

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
    } catch {
      // Ignore malformed ds:1 block
    }
  }

  return results;
}

async function fetchAdobe(): Promise<ScrapedPosting[]> {
  // Adobe's Phenom SSR HTML ignores rk=l-india unless invoked via client widgets;
  // LinkedIn f_C=1480 with engineering keywords reliably returns Adobe India Computer Scientist / MTS / ML roles + full JDs.
  return fetchLinkedInCompany('Adobe', LINKEDIN_COMPANY_IDS.adobe);
}

function parseLinkedInCards(
  html: string,
  companyName: string,
  requiredTokens?: string[]
): ScrapedPosting[] {
  const results: ScrapedPosting[] = [];
  const cards = html.split('<li');

  for (let i = 1; i < cards.length; i++) {
    const card = cards[i];
    const idMatch =
      card.match(/urn:li:jobPosting:(\d+)/) ||
      card.match(/linkedin\.com\/jobs\/view\/[^"]*?-(\d+)/);
    const jobId = idMatch?.[1];
    if (!jobId) continue;

    const titleMatch = card.match(
      /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i
    );
    const title = titleMatch ? stripHtmlPreserveLines(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';
    if (!title || !isMidLevelSweTitle(title)) continue;

    const subtitleMatch = card.match(
      /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i
    );
    const subtitle = subtitleMatch
      ? stripHtmlPreserveLines(subtitleMatch[1]).replace(/\s+/g, ' ').trim()
      : '';

    if (requiredTokens && requiredTokens.length > 0) {
      const subLower = subtitle.toLowerCase();
      if (!requiredTokens.some((tok) => subLower.includes(tok))) {
        continue;
      }
    }

    const locMatch = card.match(
      /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    );
    const location = locMatch
      ? stripHtmlPreserveLines(locMatch[1]).replace(/\s+/g, ' ').trim()
      : 'India';
    if (!isIndiaLocation(location)) continue;

    const timeMatch = card.match(/<time[^>]*datetime="([^"]+)"/i);
    const { hours, label } = hoursAgoFromIso(timeMatch?.[1]);

    const linkMatch = card.match(/href="(https:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"]+)"/i);
    const applyUrl = linkMatch ? decodeHtmlEntities(linkMatch[1].split('?')[0]) : `https://www.linkedin.com/jobs/view/${jobId}`;

    results.push({
      id: `li-${jobId}`,
      company: companyName,
      title,
      location,
      postedAtText: label,
      freshnessHours: hours,
      applyUrl,
      fullJdText: '',
      signals: EMPTY_SIGNALS,
      source: { title: `${companyName} Careers`, url: applyUrl },
      _provider: 'linkedin',
      _remoteId: jobId,
    });
  }

  return results;
}

async function fetchLinkedInCompany(
  companyName: string,
  companyId?: string,
  requiredTokens?: string[]
): Promise<ScrapedPosting[]> {
  const seen = new Set<string>();
  const results: ScrapedPosting[] = [];

  for (const start of [0, 25]) {
    const url = companyId
      ? `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=${companyId}&keywords=Software%20Engineer&location=India&start=${start}`
      : `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(
          `${companyName} engineer`
        )}&location=India&start=${start}`;

    const html = await fetchTextSafe(url, 8500);
    if (!html || !html.includes('base-search-card')) break;

    const parsed = parseLinkedInCards(html, companyName, requiredTokens);
    for (const item of parsed) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      results.push(item);
    }

    const cardCount = (html.match(/base-search-card__title/g) || []).length;
    if (cardCount < 20) break;
    await sleep(300);
  }

  // If f_C + "Software Engineer" yielded few cards (e.g. MTS-heavy orgs), also run a broader f_C + "Engineer" pass
  if (companyId && results.length < 3) {
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=${companyId}&keywords=Engineer&location=India&start=0`;
    const html = await fetchTextSafe(url, 8500);
    if (html && html.includes('base-search-card')) {
      for (const item of parseLinkedInCards(html, companyName, requiredTokens)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        results.push(item);
      }
    }
  }

  return results;
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

async function hydrateFullJobDetails(posts: ScrapedPosting[]): Promise<void> {
  const fastPosts = posts.filter((p) => p._provider !== 'linkedin');
  const linkedInPosts = posts.filter((p) => p._provider === 'linkedin');

  await runWithConcurrency(fastPosts, 8, async (post) => {
    if (post._provider === 'gh' && post._boardSlug && post._remoteId) {
      const detail = await fetchJsonSafe<{ content?: string }>(
        `https://boards-api.greenhouse.io/v1/boards/${post._boardSlug}/jobs/${post._remoteId}`,
        6500
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
        6500
      );
      const sections = detail?.jobAd?.sections;
      if (sections) {
        const combined = [
          sections.qualifications?.text ? `Qualifications:\n${sections.qualifications.text}` : '',
          sections.jobDescription?.text ? `Description:\n${sections.jobDescription.text}` : '',
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
        6500
      );
      if (detail?.data?.jobDescription) {
        post.fullJdText = extractHighSignalJd(detail.data.jobDescription);
        post.signals = extractDeterministicSignals(post.fullJdText, post.title);
      }
    }
  });

  // Polite concurrency + jitter for LinkedIn guest job detail pages to prevent 429
  await runWithConcurrency(linkedInPosts, 2, async (post) => {
    if (!post._remoteId) return;
    await sleep(280);
    const html = await fetchTextSafe(
      `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${post._remoteId}`,
      7500
    );
    if (!html) return;

    const markupMatch = html.match(
      /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/i
    ) ||
      html.match(
        /<div[^>]*class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/i
      );

    if (markupMatch?.[1]) {
      post.fullJdText = extractHighSignalJd(markupMatch[1]);
      post.signals = extractDeterministicSignals(post.fullJdText, post.title);
    }

    const extMatch = html.match(/<code[^>]*id="applyUrl"[^>]*><!--"(https?:\/\/[^"]+)"--><\/code>/i);
    if (extMatch?.[1]) {
      const extUrl = decodeHtmlEntities(extMatch[1]);
      if (extUrl.startsWith('http')) {
        post.applyUrl = extUrl;
        post.source = { title: `${post.company} Careers`, url: extUrl };
      }
    }
  });
}

function isSeniorTitle(title: string): boolean {
  return /\b(senior|sr\.?|lead|smts|staff|iii|3)\b/i.test(title);
}

async function scrapeSingleCompany(company: TargetCompany): Promise<ScrapedPosting[]> {
  const key = company.name.toLowerCase().trim();
  if (key === 'google') return fetchGoogle();
  if (key === 'microsoft') return fetchMicrosoft();
  if (key === 'amazon') return fetchAmazon();
  if (key === 'atlassian') return fetchAtlassian();
  if (key === 'adobe') return fetchAdobe();
  if (GREENHOUSE_BOARDS[key]) return fetchGreenhouseBoard(company.name, GREENHOUSE_BOARDS[key]);
  if (LEVER_BOARDS[key]) return fetchLeverBoard(company.name, LEVER_BOARDS[key]);
  if (ASHBY_BOARDS[key]) return fetchAshbyBoard(company.name, ASHBY_BOARDS[key]);
  if (SMARTRECRUITERS_BOARDS[key]) {
    return fetchSmartRecruitersBoard(company.name, SMARTRECRUITERS_BOARDS[key]);
  }
  if (LINKEDIN_COMPANY_IDS[key]) {
    return fetchLinkedInCompany(company.name, LINKEDIN_COMPANY_IDS[key]);
  }
  if (LINKEDIN_SUBTITLE_TOKENS[key]) {
    return fetchLinkedInCompany(company.name, undefined, LINKEDIN_SUBTITLE_TOKENS[key]);
  }

  const domainLower = company.careersDomain.toLowerCase();
  const ghMatch = domainLower.match(/greenhouse\.io\/(?:v1\/boards\/)?([a-z0-9_-]+)/);
  if (ghMatch?.[1]) return fetchGreenhouseBoard(company.name, ghMatch[1]);

  const leverMatch = domainLower.match(/lever\.co\/([a-z0-9_-]+)/);
  if (leverMatch?.[1]) return fetchLeverBoard(company.name, leverMatch[1]);

  const ashbyMatch = domainLower.match(/ashbyhq\.com\/([a-z0-9_-]+)/);
  if (ashbyMatch?.[1]) return fetchAshbyBoard(company.name, ashbyMatch[1]);

  // Any custom company added by the user gets checked via LinkedIn company-name search
  const fallbackToken = key.split(/\s+/)[0];
  return fetchLinkedInCompany(company.name, undefined, fallbackToken ? [fallbackToken] : undefined);
}

export async function scrapeLiveCareerPortals(
  companies: TargetCompany[],
  recencyWindow: RecencyWindow,
  roleFocus: string
): Promise<ScrapedPosting[]> {
  void roleFocus;

  // Separate LinkedIn-backed companies from direct ATS/API companies so LinkedIn stays polite (concurrency 2)
  const linkedInCompanies: TargetCompany[] = [];
  const directCompanies: TargetCompany[] = [];

  for (const c of companies) {
    const key = c.name.toLowerCase().trim();
    const isDirect =
      key === 'google' ||
      key === 'microsoft' ||
      key === 'amazon' ||
      key === 'atlassian' ||
      Boolean(GREENHOUSE_BOARDS[key]) ||
      Boolean(LEVER_BOARDS[key]) ||
      Boolean(ASHBY_BOARDS[key]) ||
      Boolean(SMARTRECRUITERS_BOARDS[key]) ||
      /greenhouse\.io|lever\.co|ashbyhq\.com/i.test(c.careersDomain);

    if (isDirect) directCompanies.push(c);
    else linkedInCompanies.push(c);
  }

  const [directBatches, linkedInBatches] = await Promise.all([
    runWithConcurrency(directCompanies, 8, scrapeSingleCompany),
    runWithConcurrency(linkedInCompanies, 2, async (c) => {
      const res = await scrapeSingleCompany(c);
      await sleep(320);
      return res;
    }),
  ]);

  const perCompanyCap = 12;
  const cappedByCompany: ScrapedPosting[] = [];
  const seenTitleKeys = new Set<string>();
  for (const batch of [...directBatches, ...linkedInBatches]) {
    if (batch.length === 0) continue;
    const sorted = [...batch].sort((a, b) => {
      const seniorDiff = Number(isSeniorTitle(a.title)) - Number(isSeniorTitle(b.title));
      if (seniorDiff !== 0) return seniorDiff;
      return a.freshnessHours - b.freshnessHours;
    });
    let taken = 0;
    for (const item of sorted) {
      const titleKey = `${item.company.toLowerCase()}::${item.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
      if (seenTitleKeys.has(titleKey)) continue;
      seenTitleKeys.add(titleKey);
      cappedByCompany.push(item);
      taken++;
      if (taken >= perCompanyCap) break;
    }
  }

  const maxHours = recencyWindow === '24h' ? 48 : recencyWindow === '72h' ? 120 : 336;
  const freshOnly = cappedByCompany.filter((j) => j.freshnessHours <= maxHours);
  const candidates = freshOnly.length >= 6 ? freshOnly : cappedByCompany;

  candidates.sort((a, b) => {
    const seniorDiff = Number(isSeniorTitle(a.title)) - Number(isSeniorTitle(b.title));
    if (seniorDiff !== 0) return seniorDiff;
    return a.freshnessHours - b.freshnessHours;
  });

  await hydrateFullJobDetails(candidates);
  return candidates.filter((j) => j.fullJdText.trim().length > 100);
}
