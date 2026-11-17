import fs from 'node:fs/promises';
import path from 'node:path';
import type { TargetCompany, WorkspaceState } from '../src/types/workspace.ts';
import { INITIAL_COMPANIES, INITIAL_WORKSPACE_STATE } from './seedData.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'workspace.json');

let writeQueue: Promise<void> = Promise.resolve();

function mergeMissingSeedCompanies(existing: TargetCompany[]): TargetCompany[] {
  const seen = new Set(existing.map((c) => c.id));
  const additions = INITIAL_COMPANIES.filter((c) => !seen.has(c.id));
  if (additions.length === 0) return existing;
  return [...existing, ...additions];
}

interface PersistedWorkspace extends Partial<WorkspaceState> {
  schemaVersion?: number;
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedWorkspace;
    let existingCompanies =
      Array.isArray(parsed.companies) && parsed.companies.length > 0
        ? mergeMissingSeedCompanies(parsed.companies)
        : INITIAL_WORKSPACE_STATE.companies;

    const needsEnableMigration = (parsed.schemaVersion ?? 1) < 2;
    if (needsEnableMigration) {
      const seedIds = new Set(INITIAL_COMPANIES.map((c) => c.id));
      existingCompanies = existingCompanies.map((c) =>
        seedIds.has(c.id) ? { ...c, enabled: true } : c
      );
    }

    const masterResume = parsed.masterResume ?? INITIAL_WORKSPACE_STATE.masterResume;
    const needsStackMigration = (parsed.schemaVersion ?? 1) < 3;
    if (needsStackMigration && Array.isArray(masterResume.skills)) {
      masterResume.skills = masterResume.skills.map((skill) => {
        if (skill.category === 'Languages') {
          return {
            ...skill,
            items: skill.items
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.toLowerCase() !== 'java')
              .join(', '),
          };
        }
        if (skill.category === 'Backend & Frameworks') {
          return {
            ...skill,
            items: skill.items
              .split(',')
              .map((s) => s.trim())
              .filter((s) => !/^spring\s*boot$/i.test(s))
              .join(', '),
          };
        }
        return skill;
      });
    }

    const rawJobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const cleanedJobs = rawJobs.filter(
      (j) => Boolean(j.yoeAssessment) || j.status !== 'New' || Boolean(j.tailoredResumeId)
    );

    const state: WorkspaceState = {
      masterResume,
      companies: existingCompanies,
      jobs: cleanedJobs,
      tailoredResumes: Array.isArray(parsed.tailoredResumes) ? parsed.tailoredResumes : [],
      sweepHistory: Array.isArray(parsed.sweepHistory) ? parsed.sweepHistory : [],
    };

    if (cleanedJobs.length !== rawJobs.length || needsEnableMigration || needsStackMigration) {
      await saveWorkspace({ ...state, schemaVersion: 3 } as WorkspaceState);
    }

    return state;
  } catch {
    await saveWorkspace({ ...INITIAL_WORKSPACE_STATE, schemaVersion: 3 } as WorkspaceState);
    return structuredClone(INITIAL_WORKSPACE_STATE);
  }
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  const task = async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tempFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(
      tempFile,
      JSON.stringify({ ...state, schemaVersion: 3 }, null, 2),
      'utf-8'
    );
    await fs.rename(tempFile, DATA_FILE);
  };
  writeQueue = writeQueue.then(task, task);
  await writeQueue;
}
