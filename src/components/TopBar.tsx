import { Menu, RefreshCw } from 'lucide-react';
import type { WorkspaceTab } from './Sidebar.tsx';

interface TopBarProps {
  activeTab: WorkspaceTab;
  isSweeping: boolean;
  isBackgroundSweeping?: boolean;
  batchLabel?: string;
  onOpenSweepModal: () => void;
  onOpenMobileMenu: () => void;
}

const VIEW_TITLES: Record<WorkspaceTab, { section: string; detail: string }> = {
  radar: { section: 'Workspace', detail: 'Job Radar & Shortlist Queue' },
  studio: { section: 'Workspace', detail: 'Tailored Resume Studio' },
  'master-resume': { section: 'Profile', detail: 'Master Resume Baseline' },
  companies: { section: 'Watchlist', detail: 'India >40 LPA Target Companies' },
};

export function TopBar({
  activeTab,
  isSweeping,
  isBackgroundSweeping = false,
  batchLabel,
  onOpenSweepModal,
  onOpenMobileMenu,
}: TopBarProps) {
  const title = VIEW_TITLES[activeTab];
  const busy = isSweeping || isBackgroundSweeping;

  return (
    <header className="h-16 shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-8">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-400 whitespace-nowrap hidden sm:inline">{title.section}</span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-slate-900 truncate">{title.detail}</h1>
        </div>
      </div>

      <div className="shrink-0">
        <button
          type="button"
          onClick={onOpenSweepModal}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          <span>
            {busy ? batchLabel || 'Sweeping Careers...' : 'Run Career Sweep'}
          </span>
        </button>
      </div>
    </header>
  );
}
