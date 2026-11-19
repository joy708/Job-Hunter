import fsSync from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  JobOpportunity,
  JobStatus,
  ResumeData,
  SweepHistoryItem,
  TailoredResumeVersion,
  TargetCompany,
  WorkspaceState,
} from '../src/types/workspace.ts';
import { INITIAL_COMPANIES, INITIAL_WORKSPACE_STATE } from './seedData.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'radar.db');
const LEGACY_JSON_FILE = path.join(DATA_DIR, 'workspace.json');

interface PersistedLegacyWorkspace extends Partial<WorkspaceState> {
  schemaVersion?: number;
}

interface JobRow {
  id: string;
  company_key: string;
  title_key: string;
  apply_url_key: string;
  status: JobStatus;
  applied_at: string | null;
  tailored_resume_id: string | null;
  discovered_at: string;
  updated_at: string;
  data_json: string;
}

interface LedgerRow {
  match_key: string;
  job_id: string;
  company: string;
  title: string;
  apply_url: string;
  status: JobStatus;
  applied_at: string | null;
  tailored_resume_id: string | null;
  updated_at: string;
}

export function normalizeCompanyKey(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeUrlKey(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'trk',
      'trkinfo',
      'ref',
      'refid',
      'trackingid',
      'source',
    ];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }
    parsed.hash = '';
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const search = parsed.searchParams.toString();
    return `${parsed.hostname.toLowerCase()}${pathname}${search ? `?${search}` : ''}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

function ledgerKeysForJob(job: Pick<JobOpportunity, 'id' | 'company' | 'title' | 'applyUrl'>): string[] {
  const keys = [`id:${job.id}`];
  const urlKey = normalizeUrlKey(job.applyUrl);
  if (urlKey) keys.push(`url:${urlKey}`);
  const ctKey = `${normalizeCompanyKey(job.company)}::${normalizeTitleKey(job.title)}`;
  if (ctKey !== '::') keys.push(`ct:${ctKey}`);
  return keys;
}

function mergeMissingSeedCompanies(existing: TargetCompany[]): TargetCompany[] {
  const seen = new Set(existing.map((c) => c.id));
  const additions = INITIAL_COMPANIES.filter((c) => !seen.has(c.id));
  if (additions.length === 0) return existing;
  return [...existing, ...additions];
}

function applySkillAndCompanyMigrations(
  companies: TargetCompany[],
  masterResume: ResumeData,
  fromVersion: number
): { companies: TargetCompany[]; masterResume: ResumeData } {
  let nextCompanies = mergeMissingSeedCompanies(companies);
  if (fromVersion < 2) {
    const seedIds = new Set(INITIAL_COMPANIES.map((c) => c.id));
    nextCompanies = nextCompanies.map((c) => (seedIds.has(c.id) ? { ...c, enabled: true } : c));
  }

  const nextResume = structuredClone(masterResume);
  if ((fromVersion < 3 || fromVersion < 4) && Array.isArray(nextResume.skills)) {
    nextResume.skills = nextResume.skills.map((skill) => {
      if (fromVersion < 3 && skill.category === 'Languages') {
        return {
          ...skill,
          items: skill.items
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.toLowerCase() !== 'java')
            .join(', '),
        };
      }
      if (fromVersion < 3 && skill.category === 'Backend & Frameworks') {
        return {
          ...skill,
          items: skill.items
            .split(',')
            .map((s) => s.trim())
            .filter((s) => !/^spring\s*boot$/i.test(s))
            .join(', '),
        };
      }
      if (
        fromVersion < 4 &&
        skill.category === 'Cloud & Infrastructure' &&
        !/kubernetes|gke/i.test(skill.items)
      ) {
        const updatedItems = skill.items.includes('Google Cloud Platform (GCP)')
          ? skill.items.replace(
              'Google Cloud Platform (GCP)',
              'Google Cloud Platform (GCP), Kubernetes (GKE)'
            )
          : `Kubernetes (GKE), ${skill.items}`;
        return { ...skill, items: updatedItems };
      }
      return skill;
    });
  }

  return { companies: nextCompanies, masterResume: nextResume };
}

let dbInstance: DatabaseSync | null = null;

function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failure if not in transaction
    }
    throw err;
  }
}

function upsertAppliedLedgerForJob(db: DatabaseSync, job: JobOpportunity): void {
  const keys = ledgerKeysForJob(job);
  const nowIso = new Date().toISOString();

  if (job.status === 'New' && !job.tailoredResumeId && !job.appliedAt) {
    const delStmt = db.prepare('DELETE FROM applied_ledger WHERE match_key = ?');
    for (const k of keys) {
      delStmt.run(k);
    }
    return;
  }

  const upsertStmt = db.prepare(`
    INSERT INTO applied_ledger (
      match_key, job_id, company, title, apply_url, status, applied_at, tailored_resume_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_key) DO UPDATE SET
      job_id = excluded.job_id,
      company = excluded.company,
      title = excluded.title,
      apply_url = excluded.apply_url,
      status = excluded.status,
      applied_at = COALESCE(excluded.applied_at, applied_ledger.applied_at),
      tailored_resume_id = COALESCE(excluded.tailored_resume_id, applied_ledger.tailored_resume_id),
      updated_at = excluded.updated_at
  `);

  for (const k of keys) {
    upsertStmt.run(
      k,
      job.id,
      job.company,
      job.title,
      job.applyUrl,
      job.status,
      job.appliedAt ?? null,
      job.tailoredResumeId ?? null,
      nowIso
    );
  }
}

function findLedgerMatch(
  db: DatabaseSync,
  job: Pick<JobOpportunity, 'id' | 'company' | 'title' | 'applyUrl'>
): LedgerRow | undefined {
  const keys = ledgerKeysForJob(job);
  const stmt = db.prepare('SELECT * FROM applied_ledger WHERE match_key = ? LIMIT 1');
  for (const k of keys) {
    const row = stmt.get(k) as LedgerRow | undefined;
    if (row) return row;
  }
  return undefined;
}

function findExistingJobRow(
  db: DatabaseSync,
  job: Pick<JobOpportunity, 'id' | 'company' | 'title' | 'applyUrl'>
): JobRow | undefined {
  const byId = db.prepare('SELECT * FROM jobs WHERE id = ? LIMIT 1').get(job.id) as JobRow | undefined;
  if (byId) return byId;

  const urlKey = normalizeUrlKey(job.applyUrl);
  if (urlKey) {
    const byUrl = db
      .prepare('SELECT * FROM jobs WHERE apply_url_key = ? LIMIT 1')
      .get(urlKey) as JobRow | undefined;
    if (byUrl) return byUrl;
  }

  const companyKey = normalizeCompanyKey(job.company);
  const titleKey = normalizeTitleKey(job.title);
  const byCt = db
    .prepare('SELECT * FROM jobs WHERE company_key = ? AND title_key = ? LIMIT 1')
    .get(companyKey, titleKey) as JobRow | undefined;
  return byCt;
}

function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  fsSync.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      company_key TEXT NOT NULL,
      title_key TEXT NOT NULL,
      apply_url_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'New',
      applied_at TEXT,
      tailored_resume_id TEXT,
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_company_title ON jobs(company_key, title_key);
    CREATE INDEX IF NOT EXISTS idx_jobs_apply_url ON jobs(apply_url_key);

    CREATE TABLE IF NOT EXISTS applied_ledger (
      match_key TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      apply_url TEXT NOT NULL,
      status TEXT NOT NULL,
      applied_at TEXT,
      tailored_resume_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tailored_resumes (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sweep_history (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
  `);

  const initRow = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;

  if (!initRow) {
    let seedSource: PersistedLegacyWorkspace = INITIAL_WORKSPACE_STATE;
    if (fsSync.existsSync(LEGACY_JSON_FILE)) {
      try {
        const raw = fsSync.readFileSync(LEGACY_JSON_FILE, 'utf-8');
        seedSource = JSON.parse(raw) as PersistedLegacyWorkspace;
      } catch {
        seedSource = INITIAL_WORKSPACE_STATE;
      }
    }

    const fromVer = seedSource.schemaVersion ?? 1;
    const baseCompanies =
      Array.isArray(seedSource.companies) && seedSource.companies.length > 0
        ? seedSource.companies
        : INITIAL_WORKSPACE_STATE.companies;
    const baseResume = seedSource.masterResume ?? INITIAL_WORKSPACE_STATE.masterResume;
    const { companies, masterResume } = applySkillAndCompanyMigrations(
      baseCompanies,
      baseResume,
      fromVer
    );

    const rawJobs = Array.isArray(seedSource.jobs) ? seedSource.jobs : [];
    const cleanedJobs = rawJobs.filter(
      (j) => Boolean(j.yoeAssessment) || j.status !== 'New' || Boolean(j.tailoredResumeId)
    );
    const tailoredResumes = Array.isArray(seedSource.tailoredResumes)
      ? seedSource.tailoredResumes
      : [];
    const sweepHistory = Array.isArray(seedSource.sweepHistory) ? seedSource.sweepHistory : [];

    runInTransaction(db, () => {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '5')").run();
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('master_resume_json', ?)").run(
        JSON.stringify(masterResume)
      );

      const insCompany = db.prepare(
        'INSERT OR REPLACE INTO companies (id, sort_order, data_json) VALUES (?, ?, ?)'
      );
      companies.forEach((c, idx) => {
        insCompany.run(c.id, idx, JSON.stringify(c));
      });

      const insJob = db.prepare(`
        INSERT OR REPLACE INTO jobs (
          id, company_key, title_key, apply_url_key, status, applied_at, tailored_resume_id,
          discovered_at, updated_at, data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const job of cleanedJobs) {
        const nowIso = job.discoveredAt || new Date().toISOString();
        insJob.run(
          job.id,
          normalizeCompanyKey(job.company),
          normalizeTitleKey(job.title),
          normalizeUrlKey(job.applyUrl),
          job.status ?? 'New',
          job.appliedAt ?? null,
          job.tailoredResumeId ?? null,
          nowIso,
          nowIso,
          JSON.stringify(job)
        );
        if (job.status !== 'New' || job.tailoredResumeId || job.appliedAt) {
          upsertAppliedLedgerForJob(db, job);
        }
      }

      const insResume = db.prepare(
        'INSERT OR REPLACE INTO tailored_resumes (id, job_id, updated_at, data_json) VALUES (?, ?, ?, ?)'
      );
      for (const tr of tailoredResumes) {
        insResume.run(tr.id, tr.jobId, tr.updatedAt || new Date().toISOString(), JSON.stringify(tr));
      }

      const insHistory = db.prepare(
        'INSERT OR REPLACE INTO sweep_history (id, timestamp, data_json) VALUES (?, ?, ?)'
      );
      for (const sh of sweepHistory.slice(0, 15)) {
        insHistory.run(sh.id, sh.timestamp, JSON.stringify(sh));
      }
    });
  } else {
    // Ensure all 82 seed companies exist even across future restarts
    const existingRows = db
      .prepare('SELECT data_json FROM companies ORDER BY sort_order ASC')
      .all() as Array<{ data_json: string }>;
    const existingCompanies = existingRows.map((r) => JSON.parse(r.data_json) as TargetCompany);
    const merged = mergeMissingSeedCompanies(existingCompanies);
    if (merged.length !== existingCompanies.length) {
      runInTransaction(db, () => {
        const insCompany = db.prepare(
          'INSERT OR REPLACE INTO companies (id, sort_order, data_json) VALUES (?, ?, ?)'
        );
        merged.forEach((c, idx) => {
          insCompany.run(c.id, idx, JSON.stringify(c));
        });
      });
    }
  }

  dbInstance = db;
  return db;
}

function loadWorkspaceSync(): WorkspaceState {
  const db = getDb();

  const resumeRow = db
    .prepare("SELECT value FROM meta WHERE key = 'master_resume_json'")
    .get() as { value: string } | undefined;
  const masterResume = resumeRow
    ? (JSON.parse(resumeRow.value) as ResumeData)
    : structuredClone(INITIAL_WORKSPACE_STATE.masterResume);

  const companyRows = db
    .prepare('SELECT data_json FROM companies ORDER BY sort_order ASC')
    .all() as Array<{ data_json: string }>;
  const companies = companyRows.map((r) => JSON.parse(r.data_json) as TargetCompany);

  const jobRows = db
    .prepare('SELECT * FROM jobs ORDER BY discovered_at DESC, rowid ASC')
    .all() as unknown as JobRow[];
  const jobs = jobRows.map((r) => {
    const parsed = JSON.parse(r.data_json) as JobOpportunity;
    return {
      ...parsed,
      status: r.status,
      ...(r.applied_at ? { appliedAt: r.applied_at } : {}),
      ...(r.tailored_resume_id ? { tailoredResumeId: r.tailored_resume_id } : {}),
    };
  });

  const resumeRows = db
    .prepare('SELECT data_json FROM tailored_resumes ORDER BY updated_at DESC')
    .all() as Array<{ data_json: string }>;
  const tailoredResumes = resumeRows.map((r) => JSON.parse(r.data_json) as TailoredResumeVersion);

  const historyRows = db
    .prepare('SELECT data_json FROM sweep_history ORDER BY timestamp DESC LIMIT 15')
    .all() as Array<{ data_json: string }>;
  const sweepHistory = historyRows.map((r) => JSON.parse(r.data_json) as SweepHistoryItem);

  return {
    masterResume,
    companies,
    jobs,
    tailoredResumes,
    sweepHistory,
  };
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  return loadWorkspaceSync();
}

export async function saveMasterResume(masterResume: ResumeData): Promise<WorkspaceState> {
  const db = getDb();
  runInTransaction(db, () => {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('master_resume_json', ?)").run(
      JSON.stringify(masterResume)
    );
  });
  return loadWorkspaceSync();
}

export async function saveCompanies(companies: TargetCompany[]): Promise<WorkspaceState> {
  const db = getDb();
  runInTransaction(db, () => {
    db.prepare('DELETE FROM companies').run();
    const ins = db.prepare('INSERT INTO companies (id, sort_order, data_json) VALUES (?, ?, ?)');
    companies.forEach((c, idx) => {
      ins.run(c.id, idx, JSON.stringify(c));
    });
  });
  return loadWorkspaceSync();
}

export async function applySweepResults(
  newJobs: JobOpportunity[],
  historyItem: SweepHistoryItem
): Promise<{
  workspace: WorkspaceState;
  addedCount: number;
  updatedCount: number;
}> {
  const db = getDb();
  let addedCount = 0;
  let updatedCount = 0;

  runInTransaction(db, () => {
    const nowIso = new Date().toISOString();
    const updateJobStmt = db.prepare(`
      UPDATE jobs
      SET apply_url_key = ?,
          status = ?,
          applied_at = ?,
          tailored_resume_id = ?,
          discovered_at = ?,
          updated_at = ?,
          data_json = ?
      WHERE id = ?
    `);
    const insertJobStmt = db.prepare(`
      INSERT INTO jobs (
        id, company_key, title_key, apply_url_key, status, applied_at, tailored_resume_id,
        discovered_at, updated_at, data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const incoming of newJobs) {
      const existingRow = findExistingJobRow(db, incoming);
      const ledgerMatch = findLedgerMatch(db, incoming);

      if (existingRow) {
        const existingParsed = JSON.parse(existingRow.data_json) as JobOpportunity;
        const preservedStatus: JobStatus =
          existingRow.status !== 'New'
            ? existingRow.status
            : ledgerMatch?.status && ledgerMatch.status !== 'New'
            ? ledgerMatch.status
            : 'New';
        const preservedAppliedAt =
          existingRow.applied_at ?? ledgerMatch?.applied_at ?? undefined;
        const preservedTailoredId =
          existingRow.tailored_resume_id ?? ledgerMatch?.tailored_resume_id ?? undefined;

        const mergedJob: JobOpportunity = {
          ...existingParsed,
          ...incoming,
          id: existingRow.id,
          status: preservedStatus,
          ...(preservedAppliedAt ? { appliedAt: preservedAppliedAt } : {}),
          ...(preservedTailoredId ? { tailoredResumeId: preservedTailoredId } : {}),
        };

        updateJobStmt.run(
          normalizeUrlKey(mergedJob.applyUrl),
          preservedStatus,
          preservedAppliedAt ?? null,
          preservedTailoredId ?? null,
          mergedJob.discoveredAt || existingRow.discovered_at,
          nowIso,
          JSON.stringify(mergedJob),
          existingRow.id
        );

        if (preservedStatus !== 'New' || preservedTailoredId || preservedAppliedAt) {
          upsertAppliedLedgerForJob(db, mergedJob);
        }
        updatedCount++;
      } else {
        const inheritedStatus: JobStatus = ledgerMatch?.status ?? incoming.status ?? 'New';
        const inheritedAppliedAt = ledgerMatch?.applied_at ?? incoming.appliedAt ?? undefined;
        const inheritedTailoredId =
          ledgerMatch?.tailored_resume_id ?? incoming.tailoredResumeId ?? undefined;

        const jobToInsert: JobOpportunity = {
          ...incoming,
          status: inheritedStatus,
          ...(inheritedAppliedAt ? { appliedAt: inheritedAppliedAt } : {}),
          ...(inheritedTailoredId ? { tailoredResumeId: inheritedTailoredId } : {}),
        };

        insertJobStmt.run(
          jobToInsert.id,
          normalizeCompanyKey(jobToInsert.company),
          normalizeTitleKey(jobToInsert.title),
          normalizeUrlKey(jobToInsert.applyUrl),
          jobToInsert.status,
          jobToInsert.appliedAt ?? null,
          jobToInsert.tailoredResumeId ?? null,
          jobToInsert.discoveredAt || nowIso,
          nowIso,
          JSON.stringify(jobToInsert)
        );

        if (inheritedStatus !== 'New' || inheritedTailoredId || inheritedAppliedAt) {
          upsertAppliedLedgerForJob(db, jobToInsert);
        }
        addedCount++;
      }
    }

    db.prepare('INSERT OR REPLACE INTO sweep_history (id, timestamp, data_json) VALUES (?, ?, ?)').run(
      historyItem.id,
      historyItem.timestamp,
      JSON.stringify(historyItem)
    );
    db.prepare(`
      DELETE FROM sweep_history
      WHERE id NOT IN (SELECT id FROM sweep_history ORDER BY timestamp DESC LIMIT 15)
    `).run();
  });

  return {
    workspace: loadWorkspaceSync(),
    addedCount,
    updatedCount,
  };
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus
): Promise<WorkspaceState | null> {
  const db = getDb();
  let found = false;

  runInTransaction(db, () => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ? LIMIT 1').get(jobId) as
      | JobRow
      | undefined;
    if (!row) return;

    found = true;
    const nowIso = new Date().toISOString();
    const parsed = JSON.parse(row.data_json) as JobOpportunity;
    const nextAppliedAt =
      status === 'Applied' ? (row.applied_at ?? parsed.appliedAt ?? nowIso) : (row.applied_at ?? parsed.appliedAt);

    const updatedJob: JobOpportunity = {
      ...parsed,
      status,
      ...(nextAppliedAt ? { appliedAt: nextAppliedAt } : {}),
      ...(row.tailored_resume_id ? { tailoredResumeId: row.tailored_resume_id } : {}),
    };

    db.prepare(`
      UPDATE jobs
      SET status = ?, applied_at = ?, updated_at = ?, data_json = ?
      WHERE id = ?
    `).run(status, nextAppliedAt ?? null, nowIso, JSON.stringify(updatedJob), jobId);

    upsertAppliedLedgerForJob(db, updatedJob);
  });

  if (!found) return null;
  return loadWorkspaceSync();
}

export async function deleteJobById(jobId: string): Promise<WorkspaceState> {
  const db = getDb();
  runInTransaction(db, () => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ? LIMIT 1').get(jobId) as
      | JobRow
      | undefined;
    if (row) {
      const parsed = JSON.parse(row.data_json) as JobOpportunity;
      const keys = ledgerKeysForJob(parsed);
      const delLedger = db.prepare('DELETE FROM applied_ledger WHERE match_key = ?');
      for (const k of keys) {
        delLedger.run(k);
      }
    }
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    db.prepare('DELETE FROM tailored_resumes WHERE job_id = ?').run(jobId);
  });
  return loadWorkspaceSync();
}

export async function attachTailoredResume(tailored: TailoredResumeVersion): Promise<WorkspaceState> {
  const db = getDb();
  runInTransaction(db, () => {
    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT OR REPLACE INTO tailored_resumes (id, job_id, updated_at, data_json) VALUES (?, ?, ?, ?)'
    ).run(tailored.id, tailored.jobId, tailored.updatedAt || nowIso, JSON.stringify(tailored));

    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ? LIMIT 1').get(tailored.jobId) as
      | JobRow
      | undefined;
    if (jobRow) {
      const parsed = JSON.parse(jobRow.data_json) as JobOpportunity;
      // Preserve Applied / Interviewing / Archived if already set — never downgrade Applied to Tailored!
      const nextStatus: JobStatus = jobRow.status === 'New' ? 'Tailored' : jobRow.status;
      const updatedJob: JobOpportunity = {
        ...parsed,
        status: nextStatus,
        tailoredResumeId: tailored.id,
        ...(jobRow.applied_at ? { appliedAt: jobRow.applied_at } : {}),
      };
      db.prepare(`
        UPDATE jobs
        SET status = ?, tailored_resume_id = ?, updated_at = ?, data_json = ?
        WHERE id = ?
      `).run(nextStatus, tailored.id, nowIso, JSON.stringify(updatedJob), tailored.jobId);

      upsertAppliedLedgerForJob(db, updatedJob);
    }
  });
  return loadWorkspaceSync();
}

export async function updateTailoredResume(
  id: string,
  updated: TailoredResumeVersion
): Promise<WorkspaceState | null> {
  const db = getDb();
  let found = false;

  runInTransaction(db, () => {
    const row = db
      .prepare('SELECT data_json FROM tailored_resumes WHERE id = ? LIMIT 1')
      .get(id) as { data_json: string } | undefined;
    if (!row) return;

    found = true;
    const existing = JSON.parse(row.data_json) as TailoredResumeVersion;
    const merged: TailoredResumeVersion = {
      ...existing,
      ...updated,
      id,
      updatedAt: new Date().toISOString(),
    };
    db.prepare('UPDATE tailored_resumes SET updated_at = ?, data_json = ? WHERE id = ?').run(
      merged.updatedAt,
      JSON.stringify(merged),
      id
    );
  });

  if (!found) return null;
  return loadWorkspaceSync();
}
