import { useMemo, useState } from 'react';
import { ExternalLink, Plus, Search, Trash2 } from 'lucide-react';
import type { CompanyTier, TargetCompany } from '../types/workspace.ts';

interface CompaniesViewProps {
  companies: TargetCompany[];
  onSaveCompanies: (updated: TargetCompany[]) => Promise<void>;
}

const LIVE_FEED_PATTERN =
  /(greenhouse\.io|lever\.co|ashbyhq\.com|google\.com\/about\/careers|apply\.careers\.microsoft\.com|amazon\.jobs|atlassian\.com\/company\/careers|careers\.servicenow\.com|careers\.swiggy\.com|freshworks\.com\/company\/careers|whatfix\.com\/careers)/i;

export function CompaniesView({ companies, onSaveCompanies }: CompaniesViewProps) {
  const [name, setName] = useState('');
  const [tier, setTier] = useState<CompanyTier>('Warm-Up Product');
  const [compBandLPA, setCompBandLPA] = useState('42–58 LPA');
  const [careersDomain, setCareersDomain] = useState('');
  const [cultureNote, setCultureNote] = useState('');
  const [locationHubs, setLocationHubs] = useState('Bengaluru, Hyderabad');
  const [isSaving, setIsSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | CompanyTier>('all');
  const [feedOnly, setFeedOnly] = useState(false);

  const toggleCompany = async (id: string) => {
    const next = companies.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c));
    await onSaveCompanies(next);
  };

  const setGroupEnabled = async (groupTier: CompanyTier, enabled: boolean) => {
    const next = companies.map((c) => {
      if (c.tier !== groupTier) return c;
      if (enabled && feedOnly && !LIVE_FEED_PATTERN.test(c.careersDomain)) return c;
      return { ...c, enabled };
    });
    await onSaveCompanies(next);
  };

  const deleteCompany = async (id: string) => {
    const next = companies.filter((c) => c.id !== id);
    await onSaveCompanies(next);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !careersDomain.trim()) return;
    setIsSaving(true);
    try {
      const cleanDomain = careersDomain
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/, '');
      const newCompany: TargetCompany = {
        id: `co-custom-${Date.now()}`,
        name: name.trim(),
        tier,
        compBandLPA: compBandLPA.trim() || '40+ LPA',
        cultureNote: cultureNote.trim() || 'Target >40 LPA product culture.',
        careersDomain: cleanDomain,
        locationHubs: locationHubs
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
        enabled: true,
      };
      await onSaveCompanies([newCompany, ...companies]);
      setName('');
      setCareersDomain('');
      setCultureNote('');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredCompanies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return companies.filter((c) => {
      if (tierFilter !== 'all' && c.tier !== tierFilter) return false;
      if (feedOnly && !LIVE_FEED_PATTERN.test(c.careersDomain)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.cultureNote.toLowerCase().includes(q) ||
        c.locationHubs.some((h) => h.toLowerCase().includes(q)) ||
        c.careersDomain.toLowerCase().includes(q)
      );
    });
  }, [companies, searchQuery, tierFilter, feedOnly]);

  const liveFeedCount = useMemo(
    () => companies.filter((c) => LIVE_FEED_PATTERN.test(c.careersDomain)).length,
    [companies]
  );

  const renderGroup = (groupTitle: string, subtitle: string, groupTier: CompanyTier) => {
    const rows = filteredCompanies.filter((c) => c.tier === groupTier);
    const totalInTier = companies.filter((c) => c.tier === groupTier);
    if (tierFilter !== 'all' && tierFilter !== groupTier) return null;

    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">{groupTitle}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <div className="flex items-center gap-4 text-xs shrink-0">
            <span className="font-mono text-slate-500 tabular-nums">
              {totalInTier.filter((r) => r.enabled).length} / {totalInTier.length} active
            </span>
            <button
              type="button"
              onClick={() => setGroupEnabled(groupTier, true)}
              className="text-teal-700 hover:underline font-medium"
            >
              Enable all
            </button>
            <button
              type="button"
              onClick={() => setGroupEnabled(groupTier, false)}
              className="text-slate-500 hover:text-slate-900"
            >
              Disable all
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {rows.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-500">
              No companies match your search filter in this tier.
            </div>
          ) : (
            rows.map((company) => {
              const hasLiveFeed = LIVE_FEED_PATTERN.test(company.careersDomain);
              return (
                <div
                  key={company.id}
                  className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={company.enabled}
                      onChange={() => toggleCompany(company.id)}
                      aria-label={`Include ${company.name} in career sweeps`}
                      className="mt-1 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-900">{company.name}</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="font-mono text-xs text-teal-700 tabular-nums">
                          {company.compBandLPA}
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500">
                          {company.locationHubs.join(', ')}
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span
                          className={`text-xs ${
                            hasLiveFeed ? 'text-emerald-700 font-medium' : 'text-slate-400'
                          }`}
                        >
                          {hasLiveFeed ? 'Live Feed' : 'Manual Portal'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{company.cultureNote}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 pl-7 sm:pl-0">
                    <a
                      href={`https://${company.careersDomain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-teal-700"
                    >
                      <span className="truncate max-w-[200px]">{company.careersDomain}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <button
                      type="button"
                      onClick={() => deleteCompany(company.id)}
                      title="Remove company"
                      className="p-1 text-slate-400 hover:text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Add Custom Target Company */}
      <form
        onSubmit={handleAdd}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Add Target Product Company (&gt;40 LPA &amp; Good Culture)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracking{' '}
              <span className="font-mono tabular-nums font-medium text-slate-800">
                {companies.length}
              </span>{' '}
              companies ({liveFeedCount} with live ATS feeds). Paste a Greenhouse, Lever, or Ashby
              URL to auto-enable live scraping.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company name (e.g. Tekion)"
            required
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-teal-700"
          />
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as CompanyTier)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-teal-700"
          >
            <option value="Warm-Up Product">Warm-Up Product (&gt;40 LPA)</option>
            <option value="FAANG+">FAANG+ Priority</option>
          </select>
          <input
            type="text"
            value={careersDomain}
            onChange={(e) => setCareersDomain(e.target.value)}
            placeholder="Careers URL (e.g. jobs.ashbyhq.com/tekion)"
            required
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-teal-700"
          />
          <input
            type="text"
            value={compBandLPA}
            onChange={(e) => setCompBandLPA(e.target.value)}
            placeholder="Est. Comp (e.g. 45-65 LPA)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-teal-700"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={locationHubs}
            onChange={(e) => setLocationHubs(e.target.value)}
            placeholder="India hubs (e.g. Bengaluru, Pune)"
            className="sm:w-64 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-teal-700"
          />
          <input
            type="text"
            value={cultureNote}
            onChange={(e) => setCultureNote(e.target.value)}
            placeholder="Culture & WLB note"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-teal-700"
          />
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add to Watchlist</span>
          </button>
        </div>
      </form>

      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {(
            [
              { id: 'all', label: 'All Tiers' },
              { id: 'Warm-Up Product', label: 'Warm-Up' },
              { id: 'FAANG+', label: 'FAANG+' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTierFilter(tab.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                tierFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={feedOnly}
              onChange={(e) => setFeedOnly(e.target.checked)}
              className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
            />
            <span>Live ATS feeds only</span>
          </label>
          <div className="relative min-w-[210px]">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 75+ companies..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-900 focus:outline-none focus:border-teal-700"
            />
          </div>
        </div>
      </div>

      {renderGroup(
        'Warm-Up Product Companies (>40 LPA · Healthy Culture)',
        'Global SaaS, Infra, FinTech, and AI product teams ideal for early confidence-building loops.',
        'Warm-Up Product'
      )}

      {renderGroup(
        'FAANG+ High-Stakes Targets',
        'Tracked continuously so standout matches are never missed.',
        'FAANG+'
      )}
    </div>
  );
}
