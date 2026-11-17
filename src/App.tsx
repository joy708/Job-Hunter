import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CompaniesView } from './components/CompaniesView.tsx';
import { JobRadarView } from './components/JobRadarView.tsx';
import { MasterResumeView } from './components/MasterResumeView.tsx';
import { ResumeStudioView } from './components/ResumeStudioView.tsx';
import { Sidebar, type WorkspaceTab } from './components/Sidebar.tsx';
import { SweepModal } from './components/SweepModal.tsx';
import { TopBar } from './components/TopBar.tsx';
import type {
  JobStatus,
  ResumeData,
  SweepRequest,
  TailoredResumeVersion,
  TargetCompany,
  WorkspaceState,
} from './types/workspace.ts';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  let data: (T & { error?: string }) | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T & { error?: string };
    } catch {
      // Non-JSON response (e.g. HTML gateway/timeout page)
    }
  }
  if (!res.ok) {
    throw new Error(
      data?.error ||
        (text && !text.trim().startsWith('<')
          ? text.slice(0, 220)
          : `Server returned HTTP ${res.status}. Try selecting fewer companies (e.g. FAANG+ or Warm-Up only) and retrying.`)
    );
  }
  if (!data) {
    throw new Error('Server returned an unexpected non-JSON response. Please retry.');
  }
  return data;
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('radar');
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sweepModalOpen, setSweepModalOpen] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [tailoringJobId, setTailoringJobId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadInitialWorkspace = useCallback(async () => {
    try {
      const data = await apiJson<WorkspaceState>('/api/workspace');
      setWorkspace(data);
      if (data.tailoredResumes.length > 0 && !selectedResumeId) {
        setSelectedResumeId(data.tailoredResumes[0].id);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to load workspace.');
    }
  }, [selectedResumeId]);

  useEffect(() => {
    void loadInitialWorkspace();
  }, [loadInitialWorkspace]);

  const handleRunSweep = async (request: SweepRequest) => {
    setSweepModalOpen(false);
    setActiveTab('radar');
    setIsSweeping(true);
    setErrorMessage(null);
    try {
      const result = await apiJson<{
        workspace: WorkspaceState;
        addedCount: number;
        discoveredCount: number;
      }>('/api/jobs/sweep', {
        method: 'POST',
        body: JSON.stringify(request),
      });
      setWorkspace(result.workspace);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Career sweep failed.');
    } finally {
      setIsSweeping(false);
    }
  };

  const handleTailorJob = async (jobId: string) => {
    setTailoringJobId(jobId);
    setErrorMessage(null);
    try {
      const result = await apiJson<{
        workspace: WorkspaceState;
        tailored: TailoredResumeVersion;
      }>('/api/resumes/tailor', {
        method: 'POST',
        body: JSON.stringify({ jobId }),
      });
      setWorkspace(result.workspace);
      setSelectedResumeId(result.tailored.id);
      setActiveTab('studio');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to tailor resume.');
    } finally {
      setTailoringJobId(null);
    }
  };

  const handleUpdateJobStatus = async (jobId: string, status: JobStatus) => {
    try {
      const updated = await apiJson<WorkspaceState>(`/api/jobs/${jobId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setWorkspace(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update status.');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      const updated = await apiJson<WorkspaceState>(`/api/jobs/${jobId}`, {
        method: 'DELETE',
      });
      setWorkspace(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to remove job.');
    }
  };

  const handleSaveTailoredResume = async (updatedResume: TailoredResumeVersion) => {
    try {
      const updated = await apiJson<WorkspaceState>(`/api/resumes/${updatedResume.id}`, {
        method: 'PUT',
        body: JSON.stringify(updatedResume),
      });
      setWorkspace(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save tailored resume.');
    }
  };

  const handleSaveMasterResume = async (updatedMaster: ResumeData) => {
    try {
      const updated = await apiJson<WorkspaceState>('/api/workspace/resume', {
        method: 'PUT',
        body: JSON.stringify(updatedMaster),
      });
      setWorkspace(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save master resume.');
    }
  };

  const handleSaveCompanies = async (updatedCompanies: TargetCompany[]) => {
    try {
      const updated = await apiJson<WorkspaceState>('/api/workspace/companies', {
        method: 'PUT',
        body: JSON.stringify(updatedCompanies),
      });
      setWorkspace(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update company list.');
    }
  };

  if (!workspace) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        {errorMessage ? (
          <div className="max-w-md bg-white border border-rose-200 rounded-xl p-6 text-center space-y-3">
            <p className="font-display font-semibold text-slate-900">Workspace failed to load</p>
            <p className="text-sm text-rose-700">{errorMessage}</p>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                void loadInitialWorkspace();
              }}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin text-teal-700" />
            <span>Loading RapidApply Radar workspace...</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        masterResume={workspace.masterResume}
        jobCount={workspace.jobs.length}
        tailoredCount={workspace.tailoredResumes.length}
        companyCount={workspace.companies.filter((c) => c.enabled).length}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeTab={activeTab}
          isSweeping={isSweeping}
          onOpenSweepModal={() => setSweepModalOpen(true)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'radar' && (
            <JobRadarView
              jobs={workspace.jobs}
              tailoredResumes={workspace.tailoredResumes}
              isSweeping={isSweeping}
              tailoringJobId={tailoringJobId}
              errorMessage={errorMessage}
              onDismissError={() => setErrorMessage(null)}
              onOpenSweepModal={() => setSweepModalOpen(true)}
              onTailorJob={handleTailorJob}
              onOpenTailoredResume={(resumeId) => {
                setSelectedResumeId(resumeId);
                setActiveTab('studio');
              }}
              onUpdateJobStatus={handleUpdateJobStatus}
              onDeleteJob={handleDeleteJob}
            />
          )}

          {activeTab === 'studio' && (
            <ResumeStudioView
              tailoredResumes={workspace.tailoredResumes}
              jobs={workspace.jobs}
              masterResume={workspace.masterResume}
              selectedResumeId={selectedResumeId}
              onSelectResumeId={setSelectedResumeId}
              onSaveTailoredResume={handleSaveTailoredResume}
              onRegenerateTailor={handleTailorJob}
              onUpdateJobStatus={handleUpdateJobStatus}
              onGoToRadar={() => setActiveTab('radar')}
              isRegenerating={Boolean(tailoringJobId)}
            />
          )}

          {activeTab === 'master-resume' && (
            <MasterResumeView
              masterResume={workspace.masterResume}
              onSaveMasterResume={handleSaveMasterResume}
            />
          )}

          {activeTab === 'companies' && (
            <CompaniesView
              companies={workspace.companies}
              onSaveCompanies={handleSaveCompanies}
            />
          )}
        </main>
      </div>

      <SweepModal
        open={sweepModalOpen}
        companies={workspace.companies}
        isSweeping={isSweeping}
        onClose={() => setSweepModalOpen(false)}
        onRunSweep={handleRunSweep}
      />
    </div>
  );
}
