import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  JobStatus,
  ResumeData,
  SweepRequest,
  TailoredResumeVersion,
  TargetCompany,
} from './src/types/workspace.ts';
import { sweepCareerPages, tailorResumeForJob } from './server/geminiService.ts';
import { loadWorkspace, saveWorkspace } from './server/store.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Get full workspace state
  app.get('/api/workspace', async (_req, res) => {
    try {
      const workspace = await loadWorkspace();
      res.json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workspace.';
      res.status(500).json({ error: message });
    }
  });

  // Update master resume
  app.put('/api/workspace/resume', async (req, res) => {
    try {
      const masterResume = req.body as ResumeData;
      if (!masterResume?.fullName || !Array.isArray(masterResume.experience)) {
        res.status(400).json({ error: 'Invalid resume payload.' });
        return;
      }
      const workspace = await loadWorkspace();
      workspace.masterResume = masterResume;
      await saveWorkspace(workspace);
      res.json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update master resume.';
      res.status(500).json({ error: message });
    }
  });

  // Update target companies watchlist
  app.put('/api/workspace/companies', async (req, res) => {
    try {
      const companies = req.body as TargetCompany[];
      if (!Array.isArray(companies)) {
        res.status(400).json({ error: 'Invalid companies array.' });
        return;
      }
      const workspace = await loadWorkspace();
      workspace.companies = companies;
      await saveWorkspace(workspace);
      res.json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update companies.';
      res.status(500).json({ error: message });
    }
  });

  // Run live career page sweep via Gemini Search Grounding
  app.post('/api/jobs/sweep', async (req, res) => {
    try {
      const body = req.body as SweepRequest;
      const workspace = await loadWorkspace();

      const { jobs: newJobs, targetedNames } = await sweepCareerPages(
        workspace.masterResume,
        workspace.companies,
        {
          laneScope: body.laneScope ?? 'all',
          recencyWindow: body.recencyWindow ?? '72h',
          roleFocus: body.roleFocus ?? 'Backend, Distributed Systems, Cloud, and AI Platform SWE',
          companyIds: body.companyIds,
        }
      );

      // Merge newly audited jobs: update existing (company + title) entries with fresh audit results while preserving workflow state
      const existingByKey = new Map(
        workspace.jobs.map((j) => [`${j.company.toLowerCase()}::${j.title.toLowerCase()}`, j])
      );

      const added: typeof newJobs = [];
      let updatedCount = 0;
      for (const job of newJobs) {
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        const existing = existingByKey.get(key);
        if (existing) {
          existing.location = job.location;
          existing.postedAtText = job.postedAtText;
          existing.freshnessHours = job.freshnessHours;
          existing.applyUrl = job.applyUrl;
          existing.sourceUrls = job.sourceUrls;
          existing.keyRequirements = job.keyRequirements;
          existing.minQualificationsMet = job.minQualificationsMet;
          existing.minQualificationsMissing = job.minQualificationsMissing;
          existing.preferredQualificationsMet = job.preferredQualificationsMet;
          existing.preferredQualificationsMissing = job.preferredQualificationsMissing;
          existing.yoeAssessment = job.yoeAssessment;
          existing.realityVerdict = job.realityVerdict;
          existing.shortlistProbability = job.shortlistProbability;
          existing.matchReasons = job.matchReasons;
          existing.gapWarnings = job.gapWarnings;
          existing.discoveredAt = job.discoveredAt;
          updatedCount++;
        } else {
          existingByKey.set(key, job);
          added.push(job);
        }
      }

      workspace.jobs = [...added, ...workspace.jobs];
      workspace.sweepHistory = [
        {
          id: `sweep-${Date.now()}`,
          timestamp: new Date().toISOString(),
          laneScope: body.laneScope ?? 'all',
          recencyWindow: body.recencyWindow ?? '72h',
          roleFocus: body.roleFocus ?? 'Mid-Level SWE (India)',
          companiesTargeted: targetedNames,
          jobsAdded: added.length + updatedCount,
        },
        ...workspace.sweepHistory.slice(0, 14),
      ];

      await saveWorkspace(workspace);
      res.json({
        workspace,
        addedCount: added.length,
        updatedCount,
        discoveredCount: newJobs.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Career page sweep failed.';
      res.status(500).json({ error: message });
    }
  });

  // Update job application status
  app.patch('/api/jobs/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body as { status: JobStatus };
      const workspace = await loadWorkspace();
      const target = workspace.jobs.find((j) => j.id === id);
      if (!target) {
        res.status(404).json({ error: 'Job not found.' });
        return;
      }
      target.status = status;
      if (status === 'Applied' && !target.appliedAt) {
        target.appliedAt = new Date().toISOString();
      }
      await saveWorkspace(workspace);
      res.json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update job status.';
      res.status(500).json({ error: message });
    }
  });

  // Delete a job from queue
  app.delete('/api/jobs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const workspace = await loadWorkspace();
      workspace.jobs = workspace.jobs.filter((j) => j.id !== id);
      workspace.tailoredResumes = workspace.tailoredResumes.filter((r) => r.jobId !== id);
      await saveWorkspace(workspace);
      res.json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete job.';
      res.status(500).json({ error: message });
    }
  });

  // Generate a tailored resume version for a job
  app.post('/api/resumes/tailor', async (req, res) => {
    try {
      const { jobId } = req.body as { jobId: string };
      const workspace = await loadWorkspace();
      const job = workspace.jobs.find((j) => j.id === jobId);
      if (!job) {
        res.status(404).json({ error: 'Target job not found.' });
        return;
      }

      const existingCount = workspace.tailoredResumes.filter((r) => r.jobId === jobId).length;
      const tailored = await tailorResumeForJob(workspace.masterResume, job, existingCount);

      workspace.tailoredResumes = [tailored, ...workspace.tailoredResumes];
      job.tailoredResumeId = tailored.id;
      if (job.status === 'New') {
        job.status = 'Tailored';
      }

      await saveWorkspace(workspace);
      res.json({ workspace, tailored });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to tailor resume.';
      res.status(500).json({ error: message });
    }
  });

  // Save inline edits to an existing tailored resume version
  app.put('/api/resumes/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updated = req.body as TailoredResumeVersion;
      const workspace = await loadWorkspace();
      const idx = workspace.tailoredResumes.findIndex((r) => r.id === id);
      if (idx === -1) {
        res.status(404).json({ error: 'Tailored resume version not found.' });
        return;
      }
      workspace.tailoredResumes[idx] = {
        ...workspace.tailoredResumes[idx],
        ...updated,
        updatedAt: new Date().toISOString(),
      };
      await saveWorkspace(workspace);
      res.json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save tailored resume.';
      res.status(500).json({ error: message });
    }
  });

  // Return JSON 404 for unknown /api routes before SPA fallback
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Ensure /api errors always return JSON rather than Express HTML error pages
  app.use(
    '/api',
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const message = err instanceof Error ? err.message : 'Unexpected server error.';
      res.status(500).json({ error: message });
    }
  );

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RapidApply Radar running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
