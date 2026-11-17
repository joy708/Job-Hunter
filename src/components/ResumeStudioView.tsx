import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileEdit,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  JobOpportunity,
  JobStatus,
  ResumeData,
  TailoredResumeVersion,
} from '../types/workspace.ts';
import { exportResumeToPdf } from '../utils/pdfExport.ts';

interface ResumeStudioViewProps {
  tailoredResumes: TailoredResumeVersion[];
  jobs: JobOpportunity[];
  masterResume: ResumeData;
  selectedResumeId: string | null;
  onSelectResumeId: (id: string) => void;
  onSaveTailoredResume: (updated: TailoredResumeVersion) => Promise<void>;
  onRegenerateTailor: (jobId: string) => Promise<void>;
  onUpdateJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  onGoToRadar: () => void;
  isRegenerating: boolean;
}

export function ResumeStudioView({
  tailoredResumes,
  jobs,
  masterResume,
  selectedResumeId,
  onSelectResumeId,
  onSaveTailoredResume,
  onRegenerateTailor,
  onUpdateJobStatus,
  onGoToRadar,
  isRegenerating,
}: ResumeStudioViewProps) {
  const activeVersion =
    tailoredResumes.find((r) => r.id === selectedResumeId) ?? tailoredResumes[0] ?? null;

  const [draft, setDraft] = useState<ResumeData | null>(
    activeVersion ? structuredClone(activeVersion.resumeData) : null
  );
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (activeVersion) {
      setDraft(structuredClone(activeVersion.resumeData));
      setIsDirty(false);
      setSavedNotice(false);
    } else {
      setDraft(null);
    }
  }, [activeVersion?.id, activeVersion?.updatedAt]);

  if (!activeVersion || !draft) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-16 text-center max-w-lg mx-auto mt-8">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <FileEdit className="h-5 w-5" />
        </div>
        <h2 className="mt-4 font-display text-base font-semibold text-slate-900">
          No tailored resume versions generated yet
        </h2>
        <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
          Select any matched position from the Job Radar and click &ldquo;Tailor Resume&rdquo; to
          open a full editable version calibrated to that role with instant PDF export.
        </p>
        <button
          type="button"
          onClick={onGoToRadar}
          className="mt-5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
        >
          Back to Job Radar
        </button>
      </div>
    );
  }

  const linkedJob = jobs.find((j) => j.id === activeVersion.jobId);

  const handleSave = async () => {
    if (!draft) return;
    setIsSaving(true);
    try {
      await onSaveTailoredResume({
        ...activeVersion,
        resumeData: draft,
      });
      setIsDirty(false);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToMaster = () => {
    setDraft(structuredClone(masterResume));
    setIsDirty(true);
  };

  const updateBullet = (expIdx: number, bulletIdx: number, value: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next.experience[expIdx].bullets[bulletIdx] = value;
      return next;
    });
    setIsDirty(true);
  };

  const addBullet = (expIdx: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next.experience[expIdx].bullets.push('');
      return next;
    });
    setIsDirty(true);
  };

  const removeBullet = (expIdx: number, bulletIdx: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next.experience[expIdx].bullets.splice(bulletIdx, 1);
      return next;
    });
    setIsDirty(true);
  };

  const updateSkill = (idx: number, field: 'category' | 'items', value: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next.skills[idx][field] = value;
      return next;
    });
    setIsDirty(true);
  };

  return (
    <div className="space-y-4">
      {/* Studio Action Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="version-select" className="text-xs font-semibold text-slate-600">
            Active Version
          </label>
          <select
            id="version-select"
            value={activeVersion.id}
            onChange={(e) => onSelectResumeId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 focus:outline-none focus:border-teal-700"
          >
            {tailoredResumes.map((ver) => (
              <option key={ver.id} value={ver.id}>
                {ver.versionLabel} — {ver.jobTitle}
              </option>
            ))}
          </select>
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
          {isDirty && !savedNotice && (
            <span className="text-xs text-amber-700 font-medium">Unsaved edits</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {linkedJob && (
            <button
              type="button"
              onClick={() => onRegenerateTailor(linkedJob.id)}
              disabled={isRegenerating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {isRegenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>New Tailored Draft</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleResetToMaster}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset to Master</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-45"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Edits'}</span>
          </button>
          <button
            type="button"
            onClick={() =>
              exportResumeToPdf(draft, {
                company: activeVersion.company,
                jobTitle: activeVersion.jobTitle,
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download PDF</span>
          </button>
          {linkedJob && linkedJob.status !== 'Applied' && (
            <button
              type="button"
              onClick={() => onUpdateJobStatus(linkedJob.id, 'Applied')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-600/30 bg-emerald-50 text-emerald-800 text-xs font-medium hover:bg-emerald-100"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Mark Applied</span>
            </button>
          )}
        </div>
      </div>

      {/* Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Intelligence Pane */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-slate-500">Target Position</div>
                <h2 className="font-display text-base font-semibold text-slate-900 mt-0.5">
                  {activeVersion.company} — {activeVersion.jobTitle}
                </h2>
                {linkedJob && (
                  <p className="text-xs text-slate-500 mt-1">
                    {linkedJob.location} · {linkedJob.postedAtText} ·{' '}
                    <span className="font-mono tabular-nums">{linkedJob.estimatedCompLPA}</span>
                  </p>
                )}
              </div>
              {linkedJob && (
                <span className="font-mono text-base font-semibold text-teal-700 tabular-nums shrink-0">
                  {linkedJob.shortlistProbability}%
                </span>
              )}
            </div>

            {linkedJob && (
              <div className="space-y-2.5 pt-3 border-t border-slate-100 text-xs">
                {linkedJob.realityVerdict && (
                  <p className="text-slate-700 leading-relaxed">{linkedJob.realityVerdict}</p>
                )}
                {linkedJob.yoeAssessment && (
                  <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                    Experience: {linkedJob.yoeAssessment}
                  </p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-600 font-medium">{linkedJob.strategicLane}</span>
                  <a
                    href={linkedJob.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
                  >
                    <span>Open Career Posting</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                What Was Tailored
              </h3>
              <ul className="mt-2.5 space-y-2 text-xs text-slate-600 list-disc pl-4 leading-relaxed">
                {activeVersion.changeSummary.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            {activeVersion.atsKeywordsMatched.length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                  ATS Keywords Aligned
                </h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  {activeVersion.atsKeywordsMatched.join(' · ')}
                </p>
              </div>
            )}

            {linkedJob && (linkedJob.minQualificationsMissing ?? []).length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <h3 className="text-xs font-semibold text-rose-800 uppercase tracking-wider">
                  Missing Minimum Qualifications
                </h3>
                <ul className="mt-2 space-y-1.5 text-xs text-rose-700 list-disc pl-4">
                  {linkedJob.minQualificationsMissing?.map((gap, idx) => (
                    <li key={idx}>{gap}</li>
                  ))}
                </ul>
              </div>
            )}

            {linkedJob && linkedJob.gapWarnings.length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
                  Interview / Gap Watchouts
                </h3>
                <ul className="mt-2 space-y-1.5 text-xs text-amber-700 list-disc pl-4">
                  {linkedJob.gapWarnings.map((gap, idx) => (
                    <li key={idx}>{gap}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Right Full Editable Resume Sheet */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-10 space-y-6">
          {/* Header Block */}
          <div className="text-center border-b border-slate-200 pb-4 space-y-2">
            <input
              type="text"
              value={draft.fullName}
              onChange={(e) => {
                setDraft({ ...draft, fullName: e.target.value });
                setIsDirty(true);
              }}
              aria-label="Full name"
              className="w-full text-center font-display text-2xl font-bold text-slate-900 bg-transparent focus:outline-none focus:bg-slate-50 rounded px-2 py-0.5"
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-600">
              <input
                type="text"
                value={draft.email}
                onChange={(e) => {
                  setDraft({ ...draft, email: e.target.value });
                  setIsDirty(true);
                }}
                aria-label="Email"
                className="text-center bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-2 py-1"
              />
              <input
                type="text"
                value={draft.phone}
                onChange={(e) => {
                  setDraft({ ...draft, phone: e.target.value });
                  setIsDirty(true);
                }}
                aria-label="Phone"
                className="text-center bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-2 py-1"
              />
              <input
                type="text"
                value={draft.linkedinLabel}
                onChange={(e) => {
                  setDraft({ ...draft, linkedinLabel: e.target.value });
                  setIsDirty(true);
                }}
                aria-label="LinkedIn"
                className="text-center bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-2 py-1"
              />
              <input
                type="text"
                value={draft.location}
                onChange={(e) => {
                  setDraft({ ...draft, location: e.target.value });
                  setIsDirty(true);
                }}
                aria-label="Location"
                className="text-center bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-2 py-1"
              />
            </div>
          </div>

          {/* Summary */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
              Summary
            </h3>
            <textarea
              rows={4}
              value={draft.summary}
              onChange={(e) => {
                setDraft({ ...draft, summary: e.target.value });
                setIsDirty(true);
              }}
              aria-label="Professional Summary"
              className="w-full text-[13px] leading-relaxed text-slate-800 bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded p-1.5 resize-y"
            />
          </div>

          {/* Experience */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-3">
              Experience
            </h3>
            <div className="space-y-4">
              {draft.experience.map((exp, expIdx) => (
                <div key={exp.id} className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <input
                      type="text"
                      value={exp.role}
                      onChange={(e) => {
                        const next = structuredClone(draft);
                        next.experience[expIdx].role = e.target.value;
                        setDraft(next);
                        setIsDirty(true);
                      }}
                      className="font-semibold text-sm text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-1.5 py-0.5 flex-1"
                    />
                    <input
                      type="text"
                      value={exp.period}
                      onChange={(e) => {
                        const next = structuredClone(draft);
                        next.experience[expIdx].period = e.target.value;
                        setDraft(next);
                        setIsDirty(true);
                      }}
                      className="text-xs text-slate-600 sm:text-right bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-1.5 py-0.5 w-36"
                    />
                  </div>
                  <input
                    type="text"
                    value={exp.company}
                    onChange={(e) => {
                      const next = structuredClone(draft);
                      next.experience[expIdx].company = e.target.value;
                      setDraft(next);
                      setIsDirty(true);
                    }}
                    className="w-full text-xs italic text-slate-600 bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-1.5 py-0.5"
                  />

                  <div className="space-y-1.5 pt-1">
                    {exp.bullets.map((bullet, bIdx) => {
                      const isHighlighted =
                        expIdx === 0 && activeVersion.highlightedBulletIndices.includes(bIdx);
                      return (
                        <div key={bIdx} className="flex items-start gap-2 group">
                          <span className="mt-2 text-slate-400 text-xs select-none">•</span>
                          <div className="flex-1">
                            <textarea
                              rows={2}
                              value={bullet}
                              onChange={(e) => updateBullet(expIdx, bIdx, e.target.value)}
                              aria-label={`Experience bullet ${bIdx + 1}`}
                              className={`w-full text-[13px] leading-snug text-slate-800 border rounded px-2 py-1 focus:outline-none focus:border-teal-700 resize-y ${
                                isHighlighted
                                  ? 'bg-teal-50/40 border-teal-200/80'
                                  : 'bg-transparent border-transparent hover:border-slate-200'
                              }`}
                            />
                            {isHighlighted && (
                              <span className="text-[11px] font-medium text-teal-700 pl-2">
                                Tailored for {activeVersion.company}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeBullet(expIdx, bIdx)}
                            title="Remove bullet"
                            className="mt-1.5 p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-rose-700 transition-opacity"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => addBullet(expIdx)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline pt-1 pl-4"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Add bullet</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Technical Skills */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2.5">
              Technical Skills
            </h3>
            <div className="space-y-2">
              {draft.skills.map((group, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                  <input
                    type="text"
                    value={group.category}
                    onChange={(e) => updateSkill(idx, 'category', e.target.value)}
                    className="sm:col-span-3 text-xs font-semibold text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-1.5 py-1"
                  />
                  <input
                    type="text"
                    value={group.items}
                    onChange={(e) => updateSkill(idx, 'items', e.target.value)}
                    className="sm:col-span-9 text-xs text-slate-700 bg-transparent border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none rounded px-1.5 py-1"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Education & Credentials (Read-friendly editable summary) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
                Education
              </h3>
              <div className="space-y-2 text-xs text-slate-700">
                {draft.education.map((edu) => (
                  <div key={edu.id}>
                    <div className="flex justify-between font-semibold text-slate-900">
                      <span>{edu.institution}</span>
                      <span className="font-normal text-slate-500">{edu.period}</span>
                    </div>
                    <div>{edu.degree}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
                Publications &amp; Certifications
              </h3>
              <div className="space-y-1.5 text-xs text-slate-700">
                {draft.publications.map((pub) => (
                  <div key={pub.id}>
                    <span className="font-medium text-slate-900">{pub.title}</span> —{' '}
                    <span className="italic">{pub.venue}</span>
                  </div>
                ))}
                <ul className="list-disc pl-4 space-y-1 pt-1">
                  {draft.achievements.map((ach, idx) => (
                    <li key={idx}>{ach}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
