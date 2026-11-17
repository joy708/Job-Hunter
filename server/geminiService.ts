import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  JobOpportunity,
  ResumeData,
  SweepRequest,
  TailoredResumeVersion,
  TargetCompany,
} from '../src/types/workspace.ts';
import { scrapeLiveCareerPortals, type ScrapedPosting } from './careerScraper.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 28000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaOrRateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('rate limit')
  );
}

function isTimeoutError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('timeout') || msg.includes('aborted') || msg.includes('etimedout');
}

function isTransientServiceError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('500') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('try again later') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  );
}

function extractReadableErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string };
      if (parsed?.error?.message) return parsed.error.message;
      if (parsed?.message) return parsed.message;
    } catch {
      // Ignore if not valid JSON
    }
  }
  return raw;
}

function formatFriendlyGeminiError(err: unknown): Error {
  if (isQuotaOrRateError(err)) {
    return new Error(
      'Gemini API quota exceeded (429 RESOURCE_EXHAUSTED). Your current free-tier API key has hit its rate or daily limit—wait a minute to retry or select a billing-enabled API key in Settings > Secrets.'
    );
  }
  if (isTimeoutError(err)) {
    return new Error(
      'Gemini AI request timed out after 16s. Try sweeping a smaller lane (Warm-Up or FAANG+) and retrying.'
    );
  }
  if (isTransientServiceError(err)) {
    return new Error(
      `Gemini model is temporarily busy (503 UNAVAILABLE): ${extractReadableErrorMessage(err)}`
    );
  }
  return new Error(extractReadableErrorMessage(err));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripJsonFencesAndNoise(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function repairCommonJsonIssues(text: string): string {
  // Remove trailing commas before closing brackets/braces and strip unsafe ASCII control chars
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
}

function salvageCompleteArrayObjects<T>(text: string): T[] {
  const start = text.indexOf('[');
  if (start === -1) return [];
  const items: T[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let objStart = -1;

  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const candidate = repairCommonJsonIssues(text.slice(objStart, i + 1));
        try {
          items.push(JSON.parse(candidate) as T);
        } catch {
          // Skip malformed element
        }
        objStart = -1;
      }
    }
  }
  return items;
}

function parseGeminiJson<T>(rawText: string, expectedType: 'array' | 'object'): T {
  const cleaned = stripJsonFencesAndNoise(rawText);
  if (!cleaned) {
    throw new SyntaxError('Empty JSON response from Gemini');
  }

  const tryParse = (candidate: string): unknown => JSON.parse(repairCommonJsonIssues(candidate));

  let parsed: unknown;
  try {
    parsed = tryParse(cleaned);
  } catch {
    // Try extracting the outermost JSON bracket/brace block
    const openChar = expectedType === 'array' ? '[' : '{';
    const closeChar = expectedType === 'array' ? ']' : '}';
    const first = cleaned.indexOf(openChar);
    const last = cleaned.lastIndexOf(closeChar);

    if (first !== -1 && last > first) {
      try {
        parsed = tryParse(cleaned.slice(first, last + 1));
      } catch {
        if (expectedType === 'array') {
          const salvaged = salvageCompleteArrayObjects<unknown>(cleaned);
          if (salvaged.length > 0) {
            return salvaged as T;
          }
        }
        throw new SyntaxError('Malformed JSON returned by Gemini');
      }
    } else if (expectedType === 'array') {
      const salvaged = salvageCompleteArrayObjects<unknown>(cleaned);
      if (salvaged.length > 0) {
        return salvaged as T;
      }
      throw new SyntaxError('Malformed JSON array returned by Gemini');
    } else {
      throw new SyntaxError('Malformed JSON object returned by Gemini');
    }
  }

  if (expectedType === 'array') {
    if (Array.isArray(parsed)) return parsed as T;
    if (parsed && typeof parsed === 'object') {
      const firstArray = Object.values(parsed as Record<string, unknown>).find((v) =>
        Array.isArray(v)
      );
      if (firstArray) return firstArray as T;
    }
    throw new SyntaxError('Expected JSON array from Gemini');
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as T;
  }
  throw new SyntaxError('Expected JSON object from Gemini');
}

async function generateJsonWithRetry<T>(
  ai: GoogleGenAI,
  params: {
    contents: string;
    systemInstruction?: string;
    responseSchema: Record<string, unknown>;
    expectedType: 'array' | 'object';
  }
): Promise<T> {
  const attempts: Array<{ model: string; useLowThinking: boolean; waitOnRetryMs: number }> = [
    { model: 'gemini-4-hydrogen', useLowThinking: true, waitOnRetryMs: 1000 },
    { model: 'gemini-3.1-flash-lite', useLowThinking: false, waitOnRetryMs: 2500 },
    { model: 'gemini-3.1-flash-lite', useLowThinking: false, waitOnRetryMs: 0 },
  ];

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const { model, useLowThinking, waitOnRetryMs } = attempts[i];
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: {
          ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
          ...(useLowThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      });
      const rawText = (response.text ?? '').trim();
      return parseGeminiJson<T>(rawText, params.expectedType);
    } catch (err) {
      lastErr = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Gemini attempt ${i + 1}/${attempts.length} | ${model}] failed:`, errMsg);

      const isRetryable =
        err instanceof SyntaxError ||
        isQuotaOrRateError(err) ||
        isTimeoutError(err) ||
        isTransientServiceError(err);

      if (!isRetryable) {
        throw formatFriendlyGeminiError(err);
      }
      if (i < attempts.length - 1) {
        await sleep(waitOnRetryMs);
      }
    }
  }

  if (lastErr instanceof SyntaxError) {
    throw new Error(
      `Gemini returned malformed JSON (${lastErr.message}). Please retry the sweep.`
    );
  }
  throw formatFriendlyGeminiError(lastErr);
}

function estimateCandidateProfile(masterResume: ResumeData): {
  yoeYears: number;
  hasMasters: boolean;
} {
  const monthMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  let totalMonths = 0;
  const now = new Date();

  for (const exp of masterResume.experience) {
    const m = exp.period.match(
      /([A-Za-z]{3})\s+(\d{4})\s*[–-]\s*(Present|([A-Za-z]{3})\s+(\d{4}))/i
    );
    if (m) {
      const startMonth = monthMap[m[1].toLowerCase()] ?? 0;
      const startYear = Number(m[2]);
      const endDate =
        m[3].toLowerCase() === 'present'
          ? now
          : new Date(Number(m[5]), monthMap[m[4].toLowerCase()] ?? 0, 1);
      const months =
        (endDate.getFullYear() - startYear) * 12 + (endDate.getMonth() - startMonth);
      if (months > 0) totalMonths += months;
    }
  }

  const yoeYears = totalMonths > 0 ? Math.round((totalMonths / 12) * 10) / 10 : 5.3;
  const hasMasters = masterResume.education.some((ed) =>
    /\b(m\.?tech|m\.?s\.?|master)/i.test(ed.degree)
  );
  return { yoeYears, hasMasters };
}

interface RawScoredItem {
  id: string;
  keyRequirements: string[];
  minQualificationsMet: string[];
  minQualificationsMissing: string[];
  preferredQualificationsMet: string[];
  preferredQualificationsMissing: string[];
  yoeAssessment: string;
  realityVerdict: string;
  shortlistProbability: number;
  matchReasons: string[];
  gapWarnings: string[];
}

export interface SweepCareerResult {
  jobs: JobOpportunity[];
  targetedNames: string[];
  discoveredCount: number;
  skippedMinYoeCount: number;
  scoredCount: number;
}

export async function sweepCareerPages(
  masterResume: ResumeData,
  companies: TargetCompany[],
  request: SweepRequest
): Promise<SweepCareerResult> {
  const filteredCompanies = companies.filter((c) => {
    if (request.companyIds && request.companyIds.length > 0) {
      return request.companyIds.includes(c.id);
    }
    if (!c.enabled) return false;
    if (request.laneScope === 'faang') return c.tier === 'FAANG+';
    if (request.laneScope === 'warmup') return c.tier === 'Warm-Up Product';
    return true;
  });

  if (filteredCompanies.length === 0) {
    throw new Error('Select at least one enabled target company before running a career sweep.');
  }

  const targetedNames = filteredCompanies.map((c) => c.name);

  // Step 1: Fetch exhaustive live postings + FULL JD qualification sections directly from official portals
  const scraped: ScrapedPosting[] = await scrapeLiveCareerPortals(
    filteredCompanies,
    request.recencyWindow,
    request.roleFocus
  );

  if (scraped.length === 0) {
    return {
      jobs: [],
      targetedNames,
      discoveredCount: 0,
      skippedMinYoeCount: 0,
      scoredCount: 0,
    };
  }

  const { yoeYears, hasMasters } = estimateCandidateProfile(masterResume);

  // Step 2: Pre-filter BEFORE calling Gemini Judge — never score roles whose minimum qualification is >= 5 years
  const eligiblePostings: ScrapedPosting[] = [];
  let skippedMinYoeCount = 0;

  for (const post of scraped) {
    const effectiveMinY =
      hasMasters && post.signals.minYearsWithMasters !== null
        ? post.signals.minYearsWithMasters
        : post.signals.minYearsRequired;

    if (effectiveMinY !== null && effectiveMinY >= 5) {
      skippedMinYoeCount++;
      continue;
    }
    eligiblePostings.push(post);
  }

  if (eligiblePostings.length === 0) {
    return {
      jobs: [],
      targetedNames,
      discoveredCount: scraped.length,
      skippedMinYoeCount,
      scoredCount: 0,
    };
  }

  const ai = getAiClient();

  const resumeContext = [
    `Candidate: ${masterResume.fullName} (~${yoeYears} years total full-time industry experience: ${masterResume.experience.map((e) => e.period).join(', ')}; Base Location: ${masterResume.location}; Holds Master's Degree: ${hasMasters ? 'Yes (M.Tech Information Security)' : 'No'})`,
    `Summary: ${masterResume.summary}`,
    `Experience:\n${masterResume.experience
      .map((e) => `${e.role} @ ${e.company} (${e.period})\n- ${e.bullets.join('\n- ')}`)
      .join('\n')}`,
    `Skills:\n${masterResume.skills.map((s) => `${s.category}: ${s.items}`).join('\n')}`,
    `Education: ${masterResume.education.map((ed) => `${ed.degree}, ${ed.institution} (${ed.period})`).join('; ')}`,
    `Publications: ${masterResume.publications.map((p) => `${p.title} (${p.venue})`).join('; ')}`,
    `Certifications & Awards: ${masterResume.achievements.join('; ')}`,
  ].join('\n\n');

  const scoringSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        keyRequirements: { type: Type.ARRAY, items: { type: Type.STRING } },
        minQualificationsMet: { type: Type.ARRAY, items: { type: Type.STRING } },
        minQualificationsMissing: { type: Type.ARRAY, items: { type: Type.STRING } },
        preferredQualificationsMet: { type: Type.ARRAY, items: { type: Type.STRING } },
        preferredQualificationsMissing: { type: Type.ARRAY, items: { type: Type.STRING } },
        yoeAssessment: { type: Type.STRING },
        realityVerdict: { type: Type.STRING },
        shortlistProbability: { type: Type.INTEGER },
        matchReasons: { type: Type.ARRAY, items: { type: Type.STRING } },
        gapWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        'id',
        'keyRequirements',
        'minQualificationsMet',
        'minQualificationsMissing',
        'preferredQualificationsMet',
        'preferredQualificationsMissing',
        'yoeAssessment',
        'realityVerdict',
        'shortlistProbability',
        'matchReasons',
        'gapWarnings',
      ],
    },
  };

  // Batch up to 18 eligible (<5 YoE min) postings from the 10-company sweep into a single structured Gemini Judge request
  const BATCH_SIZE = 18;
  const scoredList: RawScoredItem[] = [];

  for (let i = 0; i < eligiblePostings.length; i += BATCH_SIZE) {
    const batch = eligiblePostings.slice(i, i + BATCH_SIZE);
    const jobsForScoring = batch.map((j) => ({
      id: j.id,
      company: j.company,
      title: j.title,
      location: j.location,
      postedAtText: j.postedAtText,
      extractedSignals: {
        explicitYearsFound: j.signals.explicitYearsFound,
        minYearsRequired: j.signals.minYearsRequired,
        minYearsWithMasters: j.signals.minYearsWithMasters,
        maxYearsRequired: j.signals.maxYearsRequired,
        workModeHint: j.signals.workModeHint,
        detectedStackMentions: j.signals.detectedMandatoryStacks,
      },
      fullJobDescription: j.fullJdText.slice(0, 2400),
    }));

    const scoringPrompt = `You are a blunt, uncompromising FAANG/product technical recruiting judge evaluating whether ${masterResume.fullName} will ACTUALLY get shortlisted for each India opening. Do NOT give false hopes or optimistic inflation.

CANDIDATE GROUND TRUTH (DO NOT ASSUME UNLISTED PRODUCTION EXPERIENCE):
- Total Industry YoE: ~${yoeYears} years (Jul 2021 – Present at Deloitte USI; M.Tech 2019–2021 counts as education, NOT industry YoE unless JD explicitly credits a Master's degree as an alternate track).
- Degrees: M.Tech in Information Security (ABV-IIITM Gwalior) + B.Tech in CSE.
- Proven Production Stack: Python, C++, SQL, JavaScript; FastAPI, Django, LangGraph; Snowflake, BigQuery, PostgreSQL, Redis; GCP, Docker, CI/CD, Autoscaling; LLMs, RAG, Vertex AI; Multi-tenant RBAC, async audit pipelines, latency/cost optimization.
- NOT PROVEN IN INDUSTRY PRODUCTION (must go to Missing / Gap if JD asks for them!): Java (no hands-on industry/production experience), Spring Boot (no hands-on industry/production experience), Go (Golang), Rust, Ruby on Rails, C#/.NET, iOS/Swift, Android/Kotlin, AWS, Microsoft Azure, Kubernetes/Helm/Terraform, Kafka/Flink/Spark/Airflow, PyTorch/TensorFlow/CUDA model training, or Frontend UI/TypeScript architecture ownership (React is only in Skills with zero frontend work bullets).
- Candidate Location: ${masterResume.location} (if JD is Bengaluru/Hyderabad/Pune/NCR onsite or hybrid, note relocation/onsite commitment in gapWarnings).

MANDATORY AUDIT CHECKLIST PER JOB (keep each bullet crisp <= 14 words, max 6 items per list so structured JSON stays compact):
1. Extract EVERY Minimum / Basic / Required qualification from fullJobDescription. Check whether the resume has concrete production proof:
   - Proven items -> minQualificationsMet
   - Missing, unproven, or partial items -> minQualificationsMissing (be brutally honest!)
2. Extract EVERY Preferred / Bonus / Nice-to-Have qualification and split into preferredQualificationsMet vs preferredQualificationsMissing.
3. Audit Years of Experience strictly in yoeAssessment using extractedSignals and fullJobDescription:
   - Format like: "${yoeYears} YoE vs 3+ yrs req (Fits)" or "${yoeYears} YoE + M.Tech vs 3+ yrs w/ Master's (Fits)" or "${yoeYears} YoE vs 5+ yrs / Senior expectation (Higher YoE — Low Score)" or "${yoeYears} YoE vs 1-3 yrs target (Over-leveled)".
   - CRITICAL YOE POLICY: Roles expecting 5+ years of minimum experience or Senior/Lead multi-team architecting scope (implied higher YOE) MUST receive VERY LOW scores (10–28)!
4. Check Work Mode, Location, Domain & Role Scope: note onsite/hybrid/relocation, on-call/SRE ops focus, or domain mismatch (e.g., Java/Spring-Boot-only, frontend/mobile/embedded/data-science-only) in gapWarnings and minQualificationsMissing when mandatory.
5. Apply STRICT CALIBRATED SCORING CAPS for shortlistProbability (0 to 100):
   - 10–28 (Higher YoE / Major Blocker): JD requires or implies 5+ / 6+ / 7+ / 8+ years experience, Senior/Lead architecture track expecting higher YoE, or hard primary stack blocker.
   - 29–44 (Low Odds): Missing ANY mandatory core Minimum Qualification or primary stack/domain Joy lacks (Java/Spring Boot-only backend, Go, Rust, Ruby, iOS/Android, Frontend-only, Kubernetes internals).
   - 45–64 (Borderline / Stretch): Fits YoE (<5 yrs min), and missing 1 secondary minimum qualification or key primary cloud/streaming tool (e.g., AWS+Kafka shop vs Joy's GCP+Snowflake+Redis+Python/FastAPI/Django).
   - 65–76 (Viable Match): Meets ALL Minimum Qualifications and YoE cleanly, but meets <50% of Preferred Qualifications.
   - 77–89 (Strong Shortlist): Meets ALL Minimum Qualifications, matches YoE cleanly, AND meets >=50% of Preferred Qualifications (direct overlap with Python, C++, FastAPI/Django, GCP/Snowflake/BigQuery/Redis, Multi-tenant RBAC, or LLM/RAG).
   - NEVER score above 90 unless virtually every single minimum and preferred requirement matches directly.
6. Write a blunt 1-sentence realityVerdict summarizing the real shortlist outlook.

CANDIDATE RESUME:
${resumeContext}

BATCH OF LIVE JOB DESCRIPTIONS TO AUDIT:
${JSON.stringify(jobsForScoring)}`;

    const batchScored = await generateJsonWithRetry<RawScoredItem[]>(ai, {
      contents: scoringPrompt,
      responseSchema: scoringSchema,
      expectedType: 'array',
    });
    scoredList.push(...batchScored);

    if (i + BATCH_SIZE < eligiblePostings.length) {
      await sleep(1200);
    }
  }

  const scoreById = new Map<string, RawScoredItem>();
  for (const s of scoredList) {
    scoreById.set(s.id, s);
  }

  const nowIso = new Date().toISOString();
  const auditedPairs: Array<{ job: JobOpportunity; excludeMinFive: boolean }> =
    eligiblePostings.map((post) => {
      const matchedCompany = filteredCompanies.find(
        (c) => c.name.toLowerCase() === post.company.toLowerCase()
      );
      const tier = matchedCompany?.tier ?? 'Warm-Up Product';
      const strategicLane = tier === 'FAANG+' ? 'FAANG+ Priority' : 'Warm-Up First';
      const scored = scoreById.get(post.id);

      const minMet = [...(scored?.minQualificationsMet ?? [])];
      const minMissing = [...(scored?.minQualificationsMissing ?? [])];
      const prefMet = [...(scored?.preferredQualificationsMet ?? [])];
      const prefMissing = [...(scored?.preferredQualificationsMissing ?? [])];
      const gapWarnings = [...(scored?.gapWarnings ?? [])];
      let yoeAssessment = scored?.yoeAssessment ?? `${yoeYears} YoE vs. role requirements`;
      let realityVerdict =
        scored?.realityVerdict ??
        (minMissing.length > 0
          ? `Gap warning: missing ${minMissing.length} minimum qualification(s).`
          : 'Meets listed minimum qualifications.');

      let calibratedProb = Number(scored?.shortlistProbability) || 50;

      // 1. Deterministic Higher-YoE Judge Guardrail:
      // If Gemini detected a >=5+ YoE minimum qualification shortfall or higher-YoE senior expectation, force very low score (<= 28)
      const yoeLower = `${yoeAssessment} ${minMissing.join(' ')} ${realityVerdict}`.toLowerCase();
      const higherYoeDetectedByJudge =
        /\b([5-9]|1\d)\+?\s*(?:-\s*\d+\s*)?years?\s*(?:req|required|minimum|min|exp)/i.test(
          yoeLower
        ) && /(shortfall|under-?leveled|higher\s*yoe|low\s*score|short\s*by|exceeds)/i.test(yoeLower);

      const effectiveMinY =
        hasMasters && post.signals.minYearsWithMasters !== null
          ? post.signals.minYearsWithMasters
          : post.signals.minYearsRequired;

      // Also catch if Gemini specifically reports a >=5 yr minimum in minQualificationsMissing
      const minFiveMissingByJudge = minMissing.some((item) =>
        /\b([5-9]|1\d)\+?\s*years?\b/i.test(item)
      );

      if (higherYoeDetectedByJudge || minFiveMissingByJudge) {
        calibratedProb = Math.min(calibratedProb, 26);
        if (!/higher yoe|shortfall|under-leveled/i.test(yoeAssessment)) {
          yoeAssessment = `${yoeAssessment} (Higher YoE — Low Score)`;
        }
      } else if (
        effectiveMinY === null &&
        /\b(senior|sr\.?|lead|smts|iii|3)\b/i.test(post.title)
      ) {
        // Senior/SMTS/Computer Scientist 2 without explicit <5 YoE number: keep conservative unless clearly matched
        calibratedProb = Math.min(calibratedProb, 58);
      } else if (
        effectiveMinY !== null &&
        post.signals.maxYearsRequired !== null &&
        post.signals.maxYearsRequired <= 3 &&
        yoeYears > post.signals.maxYearsRequired + 1.5
      ) {
        const overLevelText = `Targets ${effectiveMinY}–${post.signals.maxYearsRequired} YoE (Joy at ${yoeYears} YoE may be over-leveled)`;
        if (!gapWarnings.some((item) => /over-?level|junior|band|year|yoe/i.test(item))) {
          gapWarnings.push(overLevelText);
        }
        calibratedProb = Math.min(calibratedProb, 68);
      }

      // 2. Deterministic Title-Domain Mismatch Guardrail
      if (
        /\b(frontend|front-end|ui engineer|ios|android|mobile|ruby|golang|rust|\.net|c#)\b/i.test(
          post.title
        )
      ) {
        calibratedProb = Math.min(calibratedProb, 44);
        if (minMissing.length === 0) {
          minMissing.push(
            `Role title (${post.title}) targets a primary stack outside Joy's core backend profile`
          );
        }
        if (!/low odds|mismatch|missing/i.test(realityVerdict)) {
          realityVerdict = `Low odds: ${post.title} focuses on a primary stack/domain outside Joy's production backend experience.`;
        }
      }

      // 3. Deterministic Minimum-Qual Missing Count Caps
      if (minMissing.length >= 2) {
        calibratedProb = Math.min(calibratedProb, 48);
      } else if (minMissing.length === 1) {
        calibratedProb = Math.min(calibratedProb, 64);
      }

      // 4. Ensure Detected Non-Resume Stacks & Work Mode are NEVER Silently Ignored
      const combinedAuditText = [
        ...minMissing,
        ...prefMissing,
        ...gapWarnings,
        realityVerdict,
      ]
        .join(' ')
        .toLowerCase();

      const unownedStackChecks: Array<{ label: string; keywordRx: RegExp }> = [
        { label: 'Spring Boot', keywordRx: /spring\s*boot|spring\s*framework/i },
        { label: 'Java (Industry)', keywordRx: /\bjava\b(?!script)/i },
        { label: 'Go (Golang)', keywordRx: /\bgo\b|golang/i },
        { label: 'Rust', keywordRx: /\brust\b/i },
        { label: 'Ruby', keywordRx: /\bruby\b/i },
        { label: 'C# / .NET', keywordRx: /c#|\.net|dotnet/i },
        { label: 'Mobile (iOS / Android)', keywordRx: /ios|android|swift|kotlin/i },
        { label: 'Kubernetes', keywordRx: /kubernetes|k8s/i },
        { label: 'Kafka / Streaming / Spark', keywordRx: /kafka|spark|flink|airflow|streaming/i },
        { label: 'Terraform / IaC', keywordRx: /terraform|helm|ansible|iac/i },
        { label: 'AWS', keywordRx: /\baws\b|amazon web/i },
        { label: 'Microsoft Azure', keywordRx: /azure/i },
        { label: 'PyTorch / Deep Learning', keywordRx: /pytorch|tensorflow|deep learning|cuda/i },
      ];

      for (const stackCheck of unownedStackChecks) {
        if (
          post.signals.detectedMandatoryStacks.includes(stackCheck.label) &&
          !stackCheck.keywordRx.test(combinedAuditText)
        ) {
          gapWarnings.push(
            `JD references ${stackCheck.label} — verify required depth vs. Joy's GCP/Python/C++/Snowflake background.`
          );
        }
      }

      if (
        post.signals.workModeHint &&
        !/remote/i.test(post.signals.workModeHint) &&
        !/remote/i.test(post.location) &&
        !/onsite|hybrid|in-office|relocat|kolkata/i.test(combinedAuditText)
      ) {
        gapWarnings.push(
          `${post.signals.workModeHint} in ${post.location} (requires relocation from ${masterResume.location}).`
        );
      }

      return {
        excludeMinFive: false,
        job: {
          id: post.id,
          company: post.company,
          title: post.title,
          location: post.location,
          postedAtText: post.postedAtText,
          freshnessHours: post.freshnessHours,
          applyUrl: post.applyUrl,
          sourceUrls: [post.source],
          tier,
          estimatedCompLPA: matchedCompany?.compBandLPA || '40–60 LPA',
          cultureSummary:
            matchedCompany?.cultureNote || 'Product engineering culture with >40 LPA India bands.',
          keyRequirements: (scored?.keyRequirements ?? []).slice(0, 8),
          minQualificationsMet: minMet,
          minQualificationsMissing: minMissing,
          preferredQualificationsMet: prefMet,
          preferredQualificationsMissing: prefMissing,
          yoeAssessment,
          realityVerdict,
          shortlistProbability: Math.max(10, Math.min(90, Math.round(calibratedProb))),
          strategicLane,
          matchReasons: (scored?.matchReasons ?? []).slice(0, 4),
          gapWarnings: gapWarnings.slice(0, 6),
          status: 'New',
          discoveredAt: nowIso,
        },
      };
    });

  const jobs = auditedPairs.filter((p) => !p.excludeMinFive).map((p) => p.job);
  jobs.sort((a, b) => b.shortlistProbability - a.shortlistProbability);

  return {
    jobs,
    targetedNames,
    discoveredCount: scraped.length,
    skippedMinYoeCount,
    scoredCount: jobs.length,
  };
}

interface RawTailoredOutput {
  changeSummary: string[];
  highlightedBulletIndices: number[];
  atsKeywordsMatched: string[];
  summary: string;
  experienceBullets: string[];
  skills: Array<{ category: string; items: string }>;
}

export async function tailorResumeForJob(
  masterResume: ResumeData,
  job: JobOpportunity,
  existingVersionCount: number
): Promise<TailoredResumeVersion> {
  const ai = getAiClient();

  const baseExp = masterResume.experience[0];
  const baseBullets = baseExp?.bullets ?? [];

  const systemInstruction = `You are a precision resume editor tailoring a software engineer's CV for a specific job opening.
CRITICAL TRUTH & GROUNDING RULES:
- NEVER fabricate companies, roles, dates, certifications, projects, technologies, or metrics not present in the Master Resume.
- NEVER claim or imply hands-on industry/production experience in Java or Spring Boot.
- Preserve every factual metric ($20K+ annually, 30% p95 API latency, 40% faster p50, 3x faster startup, 20% Snowflake compute, 50% data release timeline, 3x concurrency, 3 Outstanding Performance Awards, 5 Applause Awards).
- Keep the resume crisp enough to fit comfortably on a single A4/Letter page: keep the summary 3-4 sentences and keep 9-11 tightly worded experience bullets.
- Reorder and lightly sharpen phrasing in the summary, top experience bullets, and skill categories to align naturally with the target job's terminology and priorities.`;

  const prompt = `Tailor Joy Brahma's Master Resume for this specific role:

TARGET JOB:
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
Key Requirements: ${job.keyRequirements.join('; ')}
Minimum Qualifications Met: ${(job.minQualificationsMet ?? []).join('; ')}
Minimum Qualifications Missing (DO NOT FABRICATE THESE): ${(job.minQualificationsMissing ?? []).join('; ')}
Preferred Qualifications Met: ${(job.preferredQualificationsMet ?? []).join('; ')}
Reality Verdict: ${job.realityVerdict ?? ''}

MASTER RESUME SUMMARY:
${masterResume.summary}

MASTER EXPERIENCE (${baseExp?.role ?? 'Engineer-2'} at ${baseExp?.company ?? 'Deloitte USI'}, ${baseExp?.period ?? 'Jul 2021 – Present'}):
${baseBullets.map((b, i) => `[${i}] ${b}`).join('\n')}

MASTER SKILLS:
${masterResume.skills.map((s) => `${s.category}: ${s.items}`).join('\n')}

Return:
- changeSummary: 3-5 concise bullets describing the exact tailoring edits made for ${job.company}.
- highlightedBulletIndices: 0-based indices (in your returned experienceBullets array) of the 3-5 bullets most specifically aligned/refined for this role.
- atsKeywordsMatched: 6-10 high-signal technical keywords from the target role that are authentically supported by Joy's resume.
- summary: The tailored professional summary.
- experienceBullets: The complete ordered list of tailored experience bullets (9-11 bullets).
- skills: Reordered skill groups prioritizing the most relevant stack first (do not add skills Joy does not have).`;

  const tailorSchema = {
    type: Type.OBJECT,
    properties: {
      changeSummary: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      highlightedBulletIndices: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER },
      },
      atsKeywordsMatched: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      summary: { type: Type.STRING },
      experienceBullets: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      skills: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            items: { type: Type.STRING },
          },
          required: ['category', 'items'],
        },
      },
    },
    required: [
      'changeSummary',
      'highlightedBulletIndices',
      'atsKeywordsMatched',
      'summary',
      'experienceBullets',
      'skills',
    ],
  };

  const parsed = await generateJsonWithRetry<RawTailoredOutput>(ai, {
    contents: prompt,
    systemInstruction,
    responseSchema: tailorSchema,
    expectedType: 'object',
  });

  const tailoredResumeData: ResumeData = {
    ...structuredClone(masterResume),
    summary: parsed.summary || masterResume.summary,
    experience: masterResume.experience.map((exp, idx) =>
      idx === 0
        ? {
            ...exp,
            bullets:
              Array.isArray(parsed.experienceBullets) && parsed.experienceBullets.length > 0
                ? parsed.experienceBullets
                : exp.bullets,
          }
        : exp
    ),
    skills:
      Array.isArray(parsed.skills) && parsed.skills.length > 0
        ? parsed.skills
        : masterResume.skills,
  };

  const versionNum = existingVersionCount + 1;
  const safeSlug = job.company.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return {
    id: `cv-${safeSlug}-${Date.now()}`,
    jobId: job.id,
    company: job.company,
    jobTitle: job.title,
    versionLabel: `v${versionNum} · ${job.company}`,
    updatedAt: new Date().toISOString(),
    changeSummary: parsed.changeSummary ?? [],
    highlightedBulletIndices: parsed.highlightedBulletIndices ?? [],
    atsKeywordsMatched: parsed.atsKeywordsMatched ?? [],
    resumeData: tailoredResumeData,
  };
}
