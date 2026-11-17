import { useState } from 'react';
import { Radar, Search, X } from 'lucide-react';
import type { RecencyWindow, SweepRequest, TargetCompany } from '../types/workspace.ts';

interface SweepModalProps {
  open: boolean;
  companies: TargetCompany[];
  isSweeping: boolean;
  onClose: () => void;
  onRunSweep: (request: SweepRequest) => Promise<void>;
}

export function SweepModal({
  open,
  companies,
  isSweeping,
  onClose,
  onRunSweep,
}: SweepModalProps) {
  const [laneScope, setLaneScope] = useState<'all' | 'warmup' | 'faang'>('all');
  const [recencyWindow, setRecencyWindow] = useState<RecencyWindow>('72h');
  const [roleFocus, setRoleFocus] = useState(
    'Mid-Level Software Engineer / SDE-2 (Backend, Distributed Systems, Cloud, AI Platform)'
  );
  const [companyQuery, setCompanyQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    companies.filter((c) => c.enabled).map((c) => c.id)
  );

  if (!open) return null;

  const q = companyQuery.trim().toLowerCase();
  const visibleCompanies = companies.filter((c) => {
    if (laneScope === 'faang' && c.tier !== 'FAANG+') return false;
    if (laneScope === 'warmup' && c.tier !== 'Warm-Up Product') return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q);
  });

  const handleScopeChange = (nextScope: 'all' | 'warmup' | 'faang') => {
    setLaneScope(nextScope);
    const matching = companies
      .filter((c) => {
        if (!c.enabled) return false;
        if (nextScope === 'faang') return c.tier === 'FAANG+';
        if (nextScope === 'warmup') return c.tier === 'Warm-Up Product';
        return true;
      })
      .map((c) => c.id);
    setSelectedIds(matching);
  };

  const toggleCompany = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllVisible = () => {
    const visibleIds = new Set(visibleCompanies.map((c) => c.id));
    setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const clearVisible = () => {
    const visibleIds = new Set(visibleCompanies.map((c) => c.id));
    setSelectedIds((prev) => prev.filter((id) => !visibleIds.has(id)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const scopedSelection = companies
      .filter((c) => {
        if (!selectedIds.includes(c.id)) return false;
        if (laneScope === 'faang') return c.tier === 'FAANG+';
        if (laneScope === 'warmup') return c.tier === 'Warm-Up Product';
        return true;
      })
      .map((c) => c.id);

    await onRunSweep({
      laneScope,
      recencyWindow,
      roleFocus,
      companyIds: scopedSelection,
    });
  };

  const activeSelectionCount = companies.filter((c) => {
    if (!selectedIds.includes(c.id)) return false;
    if (laneScope === 'faang') return c.tier === 'FAANG+';
    if (laneScope === 'warmup') return c.tier === 'Warm-Up Product';
    return true;
  }).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sweep-modal-title"
        className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="sweep-modal-title" className="font-display text-lg font-semibold text-slate-900">
              Configure Live Career-Page Sweep
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Fetches live openings across official career portals &amp; ATS boards in India.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Strategic Lane Scope
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'all', label: 'All >40L' },
                    { id: 'warmup', label: 'Warm-Up' },
                    { id: 'faang', label: 'FAANG+' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleScopeChange(opt.id)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      laneScope === opt.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Posting Freshness Priority
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: '24h', label: 'Last 24h' },
                    { id: '72h', label: 'Last 72h' },
                    { id: '7d', label: 'Last 7d' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setRecencyWindow(opt.id)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      recencyWindow === opt.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="role-focus-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Target Role Focus
            </label>
            <input
              id="role-focus-input"
              type="text"
              value={roleFocus}
              onChange={(e) => setRoleFocus(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              placeholder="e.g. SDE-2 Backend Distributed Systems Python Java"
            />
          </div>

          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Career Portals Selected ({activeSelectionCount})
              </span>
              <div className="flex items-center gap-3 text-xs">
                <div className="relative">
                  <Search className="h-3 w-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={companyQuery}
                    onChange={(e) => setCompanyQuery(e.target.value)}
                    placeholder="Filter companies..."
                    className="pl-7 pr-2.5 py-1 rounded-md border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-teal-700 w-40"
                  />
                </div>
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="text-teal-700 hover:underline font-medium"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearVisible}
                  className="text-slate-500 hover:text-slate-900"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-3 rounded-lg border border-slate-200 bg-slate-50/70">
              {visibleCompanies.map((company) => {
                const checked = selectedIds.includes(company.id);
                return (
                  <label
                    key={company.id}
                    className={`flex items-start gap-2 p-2 rounded-md border text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'bg-white border-teal-700/40 text-slate-900'
                        : 'bg-transparent border-transparent text-slate-600 hover:bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCompany(company.id)}
                      className="mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                    />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{company.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {company.tier === 'FAANG+' ? 'FAANG+' : 'Warm-Up'} · {company.compBandLPA}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSweeping || activeSelectionCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              <Radar className="h-4 w-4" />
              <span>{isSweeping ? 'Sweeping Portals...' : 'Start Live Sweep'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
