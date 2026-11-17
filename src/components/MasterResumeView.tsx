import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Plus, Save, Trash2 } from 'lucide-react';
import type { ResumeData } from '../types/workspace.ts';
import { exportResumeToPdf } from '../utils/pdfExport.ts';

interface MasterResumeViewProps {
  masterResume: ResumeData;
  onSaveMasterResume: (updated: ResumeData) => Promise<void>;
}

export function MasterResumeView({
  masterResume,
  onSaveMasterResume,
}: MasterResumeViewProps) {
  const [draft, setDraft] = useState<ResumeData>(() => structuredClone(masterResume));
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(structuredClone(masterResume));
    setIsDirty(false);
  }, [masterResume]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveMasterResume(draft);
      setIsDirty(false);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Baseline Master Resume
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pre-loaded from Joy_Brahma_Resume.pdf. All job sweeps and tailored CV versions use this
            as ground truth.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={() => exportResumeToPdf(draft)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export PDF</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-45"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Master Resume'}</span>
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Full Name</label>
            <input
              type="text"
              value={draft.fullName}
              onChange={(e) => {
                setDraft({ ...draft, fullName: e.target.value });
                setIsDirty(true);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Location</label>
            <input
              type="text"
              value={draft.location}
              onChange={(e) => {
                setDraft({ ...draft, location: e.target.value });
                setIsDirty(true);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
            <input
              type="email"
              value={draft.email}
              onChange={(e) => {
                setDraft({ ...draft, email: e.target.value });
                setIsDirty(true);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Phone</label>
            <input
              type="text"
              value={draft.phone}
              onChange={(e) => {
                setDraft({ ...draft, phone: e.target.value });
                setIsDirty(true);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-700"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Summary</label>
          <textarea
            rows={4}
            value={draft.summary}
            onChange={(e) => {
              setDraft({ ...draft, summary: e.target.value });
              setIsDirty(true);
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed text-slate-800 focus:outline-none focus:border-teal-700"
          />
        </div>

        <div>
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
            Experience
          </h3>
          {draft.experience.map((exp, expIdx) => (
            <div key={exp.id} className="space-y-3 border-t border-slate-200 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={exp.role}
                  onChange={(e) => {
                    const next = structuredClone(draft);
                    next.experience[expIdx].role = e.target.value;
                    setDraft(next);
                    setIsDirty(true);
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-900 focus:outline-none focus:border-teal-700"
                />
                <input
                  type="text"
                  value={exp.company}
                  onChange={(e) => {
                    const next = structuredClone(draft);
                    next.experience[expIdx].company = e.target.value;
                    setDraft(next);
                    setIsDirty(true);
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-teal-700"
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
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="space-y-2">
                {exp.bullets.map((b, bIdx) => (
                  <div key={bIdx} className="flex items-start gap-2">
                    <span className="mt-2.5 text-xs font-mono text-slate-400 w-5 text-right shrink-0">
                      {bIdx + 1}.
                    </span>
                    <textarea
                      rows={2}
                      value={b}
                      onChange={(e) => {
                        const next = structuredClone(draft);
                        next.experience[expIdx].bullets[bIdx] = e.target.value;
                        setDraft(next);
                        setIsDirty(true);
                      }}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs leading-relaxed text-slate-800 focus:outline-none focus:border-teal-700"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = structuredClone(draft);
                        next.experience[expIdx].bullets.splice(bIdx, 1);
                        setDraft(next);
                        setIsDirty(true);
                      }}
                      className="mt-2 p-1 text-slate-400 hover:text-rose-700"
                      aria-label="Remove bullet"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const next = structuredClone(draft);
                    next.experience[expIdx].bullets.push('');
                    setDraft(next);
                    setIsDirty(true);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline pl-7"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add experience bullet</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
            Technical Skills
          </h3>
          <div className="space-y-2.5">
            {draft.skills.map((sk, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <input
                  type="text"
                  value={sk.category}
                  onChange={(e) => {
                    const next = structuredClone(draft);
                    next.skills[idx].category = e.target.value;
                    setDraft(next);
                    setIsDirty(true);
                  }}
                  className="sm:col-span-4 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-900 focus:outline-none focus:border-teal-700"
                />
                <input
                  type="text"
                  value={sk.items}
                  onChange={(e) => {
                    const next = structuredClone(draft);
                    next.skills[idx].items = e.target.value;
                    setDraft(next);
                    setIsDirty(true);
                  }}
                  className="sm:col-span-8 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-teal-700"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
