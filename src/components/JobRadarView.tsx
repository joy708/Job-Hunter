import { Fragment, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileEdit,
  Loader2,
  Radar,
  Search,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  JobOpportunity,
  JobStatus,
  SweepBatchProgress,
  TailoredResumeVersion,
} from '../types/workspace.ts';
import { exportResumeToPdf } from '../utils/pdfExport.ts';

interface JobRadarViewProps {
  jobs: JobOpportunity[];
  tailoredResumes: TailoredResumeVersion[];
  isSweeping: boolean;
  sweepProgress: SweepBatchProgress | null;
  tailoringJobId: string | null;
  errorMessage: string | null;
  onDismissError: () => void;
  onStopSweep: () => void;
  onResumeSweep: () => void;
  onDismissSweepProgress: () => void;
  onOpenSweepModal: () => void;
  onTailorJob: (jobId: string) => Promise<void>;
  onOpenTailoredResume: (resumeId: string) => void;
  onUpdateJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  onDeleteJob: (jobId: string) => Promise<void>;
}

type LaneFilter = 'all' | 'warmup' | 'faang' | 'active-pipeline';
type SortMode = 'probability' | 'freshness';

function probabilityTone(score: number): { color: string; label: string } {
  if (score >= 77) return { color: 'text-emerald-700', label: 'Strong Shortlist' };
  if (score >= 65) return { color: 'text-teal-700', label: 'Viable' };
  if (score >= 48) return { color: 'text-amber-700', label: 'Borderline' };
  return { color: 'text-rose-700', label: 'Low Odds' };
}

export function JobRadarView({
  jobs,
  tailoredResumes,
  isSweeping,
  sweepProgress,
  tailoringJobId,
  errorMessage,
  onDismissError,
  onStopSweep,
  onResumeSweep,
  onDismissSweepProgress,
  onOpenSweepModal,
  onTailorJob,
  onOpenTailoredResume,
  onUpdateJobStatus,
  onDeleteJob,
}: JobRadarViewProps) {
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [minProbability, setMinProbability] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortMode>('probability');
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const resumeById = useMemo(() => {
    const map = new Map<string, TailoredResumeVersion>();
    for (const r of tailoredResumes) {
      map.set(r.id, r);
    }
    return map;
  }, [tailoredResumes]);

  const metrics = useMemo(() => {
    const active = jobs.filter((j) => j.status !== 'Archived');
    const warmUpHigh = active.filter(
      (j) => j.strategicLane === 'Warm-Up First' && j.shortlistProbability >= 65
    );
    const faangPriority = active.filter(
      (j) => j.strategicLane === 'FAANG+ Priority' && j.shortlistProbability >= 65
    );
    const applied = active.filter(
      (j) => j.status === 'Applied' || j.status === 'Interviewing'
    );
    return {
      activeCount: active.length,
      warmUpHighCount: warmUpHigh.length,
      faangCount: faangPriority.length,
      appliedCount: applied.length,
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return jobs
      .filter((job) => {
        if (laneFilter === 'warmup' && job.strategicLane !== 'Warm-Up First') return false;
        if (laneFilter === 'faang' && job.strategicLane !== 'FAANG+ Priority') return false;
        if (
          laneFilter === 'active-pipeline' &&
          job.status !== 'Tailored' &&
          job.status !== 'Applied' &&
          job.status !== 'Interviewing'
        ) {
          return false;
        }
        if (job.shortlistProbability < minProbability) return false;
        if (!q) return true;
        return (
          job.company.toLowerCase().includes(q) ||
          job.title.toLowerCase().includes(q) ||
          job.location.toLowerCase().includes(q) ||
          (job.realityVerdict ?? '').toLowerCase().includes(q) ||
          job.keyRequirements.some((r) => r.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'freshness') {
          return a.freshnessHours - b.freshnessHours || b.shortlistProbability - a.shortlistProbability;
        }
        return b.shortlistProbability - a.shortlistProbability || a.freshnessHours - b.freshnessHours;
      });
  }, [jobs, laneFilter, searchQuery, minProbability, sortBy]);

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-rose-700 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Career sweep or AI request could not complete</p>
              <p className="text-xs text-rose-700 mt-0.5">{errorMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismissError}
            className="text-xs font-medium text-rose-700 hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {sweepProgress && (
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${
            sweepProgress.status === 'running'
              ? 'border-teal-200 bg-teal-50/70 text-slate-800'
              : sweepProgress.status === 'completed'
              ? 'border-emerald-200 bg-emerald-50/70 text-slate-800'
              : 'border-amber-200 bg-amber-50/70 text-slate-800'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {sweepProgress.status === 'running' ? (
              <Loader2 className="h-4 w-4 animate-spin text-teal-700 mt-0.5 shrink-0" />
            ) : sweepProgress.status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium text-slate-900 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>
                  {sweepProgress.status === 'running'
                    ? `Batch ${sweepProgress.currentBatch} of ${sweepProgress.totalBatches} sweeping`
                    : sweepProgress.status === 'completed'
                    ? 'Full batched sweep complete'
                    : sweepProgress.status === 'paused'
                    ? `Sweep paused at batch ${sweepProgress.currentBatch} of ${sweepProgress.totalBatches}`
                    : `Sweep stopped at batch ${sweepProgress.currentBatch} of ${sweepProgress.totalBatches}`}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {sweepProgress.companiesChecked}/{sweepProgress.totalCompanies} companies
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Found {sweepProgress.discoveredCount}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-600">
                  Skipped {sweepProgress.skippedMinYoeCount} (≥5 yrs min YoE)
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-teal-800">
                  Scored {sweepProgress.scoredCount} ({sweepProgress.addedCount} new, {sweepProgress.updatedCount} refreshed)
                </span>
              </div>
              {sweepProgress.status === 'running' && sweepProgress.currentBatchNames.length > 0 && (
                <p className="text-[11px] text-slate-600 truncate">
                  Active batch: {sweepProgress.currentBatchNames.join(', ')}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {sweepProgress.status === 'running' && (
              <button
                type="button"
                onClick={onStopSweep}
                className="px-3 py-1 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Stop Sweep
              </button>
            )}
            {(sweepProgress.status === 'paused' || sweepProgress.status === 'stopped') &&
              sweepProgress.remainingCompanyIds.length > 0 && (
                <button
                  type="button"
                  onClick={onResumeSweep}
                  className="px-3 py-1 rounded-md bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 whitespace-nowrap"
                >
                  Resume Remaining ({Math.ceil(sweepProgress.remainingCompanyIds.length / 10)} batches)
                </button>
              )}
            {sweepProgress.status !== 'running' && (
              <button
                type="button"
                onClick={onDismissSweepProgress}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline px-1.5 py-1"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-slate-500">Audited Openings</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {metrics.activeCount}
            </span>
            <span className="text-xs text-slate-500">Full JD checked</span>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-slate-500">Viable Warm-Ups (≥65%)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-teal-700 tabular-nums">
              {metrics.warmUpHighCount}
            </span>
            <span className="text-xs text-slate-500">Early loop practice</span>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-slate-500">Viable FAANG+ (≥65%)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {metrics.faangCount}
            </span>
            <span className="text-xs text-slate-500">High-stakes matches</span>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-slate-500">Applications Sent</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {metrics.appliedCount}
            </span>
            <span className="text-xs text-slate-500">Tracked fast-applies</span>
          </div>
        </div>
      </div>

      {/* Controls & Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
            {(
              [
                { id: 'all', label: 'All Audited' },
                { id: 'warmup', label: 'Warm-Up First' },
                { id: 'faang', label: 'FAANG+ Priority' },
                { id: 'active-pipeline', label: 'Tailored & Applied' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLaneFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  laneFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1 sm:flex-initial">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter company, role, skill..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <select
              value={minProbability}
              onChange={(e) => setMinProbability(Number(e.target.value))}
              aria-label="Minimum shortlist probability"
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-teal-700"
            >
              <option value={0}>All Audited Scores</option>
              <option value={65}>≥ 65% Viable Only</option>
              <option value={77}>≥ 77% Strong Shortlist</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortMode)}
              aria-label="Sort jobs"
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-teal-700"
            >
              <option value="probability">Sort: Realistic Fit %</option>
              <option value="freshness">Sort: Fastest / Newest</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main High-Density Queue Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isSweeping && jobs.length === 0 ? (
          <div className="divide-y divide-slate-200">
            <div className="px-5 py-3 bg-slate-50 text-xs font-medium text-slate-600 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-700" />
              <span>
                Running first batch of 10 career portals and judging Minimum &amp; Preferred
                Qualifications (&lt;5 yrs min YoE)...
              </span>
            </div>
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="px-5 py-3.5 flex items-center justify-between gap-4 animate-pulse">
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 bg-slate-200 rounded w-56" />
                  <div className="h-3 bg-slate-100 rounded w-64" />
                </div>
                <div className="h-3.5 bg-slate-100 rounded w-20" />
                <div className="h-3.5 bg-slate-200 rounded w-20" />
                <div className="h-7 bg-slate-100 rounded w-28" />
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="px-6 py-16 text-center max-w-lg mx-auto">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Radar className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-base font-semibold text-slate-900">
              No career-page openings audited yet
            </h2>
            <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
              Run a live career sweep across Google, Microsoft, Amazon, Atlassian, Snowflake,
              Databricks, Stripe, Rubrik, and 70+ Indian &gt;40 LPA product companies to audit every
              minimum and preferred qualification against Joy&apos;s resume.
            </p>
            <button
              type="button"
              onClick={onOpenSweepModal}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors"
            >
              <Radar className="h-4 w-4" />
              <span>Run First Career Sweep</span>
            </button>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-900">No jobs match the current filters.</p>
            <button
              type="button"
              onClick={() => {
                setLaneFilter('all');
                setSearchQuery('');
                setMinProbability(0);
              }}
              className="mt-2 text-xs font-medium text-teal-700 hover:underline"
            >
              Reset all filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="py-3 pl-5 pr-3">Company, Role &amp; Reality Verdict</th>
                  <th className="py-3 px-3 whitespace-nowrap">Strategic Lane</th>
                  <th className="py-3 px-3 whitespace-nowrap">Posted</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Realistic Fit</th>
                  <th className="py-3 px-3 whitespace-nowrap">Tailored Resume</th>
                  <th className="py-3 px-3 whitespace-nowrap">Status</th>
                  <th className="py-3 pl-3 pr-5 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredJobs.map((job) => {
                  const isExpanded = expandedJobId === job.id;
                  const tone = probabilityTone(job.shortlistProbability);
                  const tailored = job.tailoredResumeId
                    ? resumeById.get(job.tailoredResumeId)
                    : undefined;
                  const isTailoringThis = tailoringJobId === job.id;
                  const minMet = job.minQualificationsMet ?? [];
                  const minMissing = job.minQualificationsMissing ?? [];

                  return (
                    <Fragment key={job.id}>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 pl-5 pr-3 align-middle">
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedJobId(isExpanded ? null : job.id)
                              }
                              className="mt-0.5 text-slate-400 hover:text-slate-800 shrink-0"
                              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedJobId(isExpanded ? null : job.id)
                                }
                                className="font-medium text-slate-900 hover:text-teal-700 text-left block truncate max-w-[380px]"
                              >
                                {job.company} — {job.title}
                              </button>
                              <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                <span>{job.location}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">{job.estimatedCompLPA}</span>
                                {job.yoeAssessment && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums text-slate-700">
                                      {job.yoeAssessment}
                                    </span>
                                  </>
                                )}
                                {(minMet.length > 0 || minMissing.length > 0) && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums text-slate-600">
                                      Min quals: {minMet.length}/{minMet.length + minMissing.length} met
                                    </span>
                                  </>
                                )}
                              </div>
                              {job.realityVerdict && (
                                <p className="text-[11px] text-slate-600 mt-1 max-w-[460px] truncate">
                                  {job.realityVerdict}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <span
                            className={`text-xs font-medium ${
                              job.strategicLane === 'FAANG+ Priority'
                                ? 'text-teal-700'
                                : 'text-slate-700'
                            }`}
                          >
                            {job.strategicLane}
                          </span>
                        </td>

                        <td className="py-3 px-3 align-middle whitespace-nowrap font-mono text-xs text-slate-600 tabular-nums">
                          {job.postedAtText}
                        </td>

                        <td className="py-3 px-3 align-middle text-right whitespace-nowrap">
                          <span className={`font-mono text-sm font-semibold tabular-nums ${tone.color}`}>
                            {job.shortlistProbability}%
                          </span>
                          <span className="ml-1.5 text-xs text-slate-500">· {tone.label}</span>
                        </td>

                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          {tailored ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onOpenTailoredResume(tailored.id)}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline"
                              >
                                <FileEdit className="h-3.5 w-3.5" />
                                <span>{tailored.versionLabel}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  exportResumeToPdf(tailored.resumeData, {
                                    company: job.company,
                                    jobTitle: job.title,
                                  })
                                }
                                title="Download tailored PDF"
                                className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onTailorJob(job.id)}
                              disabled={isTailoringThis}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:border-teal-700 hover:text-teal-700 disabled:opacity-50 transition-colors"
                            >
                              {isTailoringThis ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Sparkles className="h-3 w-3" />
                              )}
                              <span>{isTailoringThis ? 'Tailoring...' : 'Tailor Resume'}</span>
                            </button>
                          )}
                        </td>

                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <select
                            value={job.status}
                            onChange={(e) =>
                              onUpdateJobStatus(job.id, e.target.value as JobStatus)
                            }
                            aria-label={`Status for ${job.company} ${job.title}`}
                            className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 focus:outline-none focus:border-teal-700"
                          >
                            <option value="New">New</option>
                            <option value="Tailored">Tailored</option>
                            <option value="Applied">Applied</option>
                            <option value="Interviewing">Interviewing</option>
                            <option value="Archived">Archived</option>
                          </select>
                        </td>

                        <td className="py-3 pl-3 pr-5 align-middle text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <a
                              href={job.applyUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-teal-700"
                            >
                              <span>Apply</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <button
                              type="button"
                              onClick={() => onDeleteJob(job.id)}
                              title="Remove from queue"
                              className="p-1 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={7} className="px-6 py-5">
                            <div className="space-y-4 text-xs">
                              {job.realityVerdict && (
                                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
                                  <div>
                                    <span className="font-semibold text-slate-900">
                                      Reality Check:{' '}
                                    </span>
                                    <span className="text-slate-700">{job.realityVerdict}</span>
                                  </div>
                                  {job.yoeAssessment && (
                                    <span className="font-mono text-slate-600 tabular-nums">
                                      Experience: {job.yoeAssessment}
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Column 1: Minimum Qualifications Audit */}
                                <div className="space-y-3">
                                  <h3 className="font-semibold text-slate-900">
                                    Minimum Qualifications Audit
                                  </h3>
                                  {minMissing.length > 0 && (
                                    <div className="space-y-1">
                                      <div className="font-medium text-rose-800">
                                        Missing / Unproven ({minMissing.length})
                                      </div>
                                      <ul className="space-y-1.5 text-rose-700">
                                        {minMissing.map((item, idx) => (
                                          <li key={idx} className="flex items-start gap-1.5">
                                            <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                            <span>{item}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {minMet.length > 0 && (
                                    <div className="space-y-1">
                                      <div className="font-medium text-emerald-800">
                                        Proven on Resume ({minMet.length})
                                      </div>
                                      <ul className="space-y-1.5 text-slate-700">
                                        {minMet.map((item, idx) => (
                                          <li key={idx} className="flex items-start gap-1.5">
                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 mt-0.5 shrink-0" />
                                            <span>{item}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {minMet.length === 0 && minMissing.length === 0 && (
                                    <ul className="space-y-1 text-slate-600 list-disc pl-4">
                                      {job.matchReasons.map((r, i) => (
                                        <li key={i}>{r}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>

                                {/* Column 2: Preferred Qualifications Audit */}
                                <div className="space-y-3">
                                  <h3 className="font-semibold text-slate-900">
                                    Preferred Qualifications Audit
                                  </h3>
                                  {(job.preferredQualificationsMet ?? []).length > 0 && (
                                    <div className="space-y-1">
                                      <div className="font-medium text-teal-800">
                                        Matched Preferred (
                                        {job.preferredQualificationsMet?.length})
                                      </div>
                                      <ul className="space-y-1.5 text-slate-700">
                                        {job.preferredQualificationsMet?.map((item, idx) => (
                                          <li key={idx} className="flex items-start gap-1.5">
                                            <CheckCircle2 className="h-3.5 w-3.5 text-teal-700 mt-0.5 shrink-0" />
                                            <span>{item}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {(job.preferredQualificationsMissing ?? []).length > 0 && (
                                    <div className="space-y-1">
                                      <div className="font-medium text-amber-800">
                                        Missing Preferred (
                                        {job.preferredQualificationsMissing?.length})
                                      </div>
                                      <ul className="space-y-1.5 text-amber-700">
                                        {job.preferredQualificationsMissing?.map((item, idx) => (
                                          <li key={idx} className="flex items-start gap-1.5">
                                            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                            <span>{item}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {(job.preferredQualificationsMet ?? []).length === 0 &&
                                    (job.preferredQualificationsMissing ?? []).length === 0 && (
                                      <ul className="space-y-1 text-slate-600 list-disc pl-4">
                                        {job.keyRequirements.map((req, idx) => (
                                          <li key={idx}>{req}</li>
                                        ))}
                                      </ul>
                                    )}
                                </div>

                                {/* Column 3: Risks, Work Mode & Sources */}
                                <div className="space-y-3">
                                  {job.gapWarnings.length > 0 && (
                                    <div>
                                      <h3 className="font-semibold text-slate-900 mb-1">
                                        Additional Gaps &amp; Logistics
                                      </h3>
                                      <ul className="space-y-1.5 text-amber-800">
                                        {job.gapWarnings.map((warn, idx) => (
                                          <li key={idx} className="flex items-start gap-1.5">
                                            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                            <span>{warn}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  <div>
                                    <h3 className="font-semibold text-slate-900 mb-1">
                                      Culture &amp; Comp Context
                                    </h3>
                                    <p className="text-slate-600 leading-relaxed">
                                      {job.cultureSummary}
                                    </p>
                                  </div>
                                  {job.sourceUrls.length > 0 && (
                                    <div>
                                      <h3 className="font-semibold text-slate-900 mb-1">
                                        Career Portal Source
                                      </h3>
                                      <div className="space-y-1">
                                        {job.sourceUrls.map((src, idx) => (
                                          <a
                                            key={idx}
                                            href={src.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1 text-teal-700 hover:underline truncate max-w-xs"
                                          >
                                            <ExternalLink className="h-3 w-3 shrink-0" />
                                            <span className="truncate">{src.title}</span>
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
