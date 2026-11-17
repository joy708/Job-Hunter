export type CompanyTier = 'FAANG+' | 'Warm-Up Product';
export type StrategicLane = 'Warm-Up First' | 'FAANG+ Priority';
export type JobStatus = 'New' | 'Tailored' | 'Applied' | 'Interviewing' | 'Archived';
export type RecencyWindow = '24h' | '72h' | '7d';

export interface SkillGroup {
  category: string;
  items: string;
}

export interface ExperienceItem {
  id: string;
  role: string;
  company: string;
  period: string;
  bullets: string[];
}

export interface EducationItem {
  id: string;
  institution: string;
  period: string;
  degree: string;
}

export interface PublicationItem {
  id: string;
  title: string;
  venue: string;
}

export interface ResumeData {
  fullName: string;
  email: string;
  phone: string;
  linkedinLabel: string;
  location: string;
  summary: string;
  experience: ExperienceItem[];
  skills: SkillGroup[];
  education: EducationItem[];
  publications: PublicationItem[];
  achievements: string[];
}

export interface TargetCompany {
  id: string;
  name: string;
  tier: CompanyTier;
  compBandLPA: string;
  cultureNote: string;
  careersDomain: string;
  locationHubs: string[];
  enabled: boolean;
}

export interface GroundedSource {
  title: string;
  url: string;
}

export interface JobOpportunity {
  id: string;
  company: string;
  title: string;
  location: string;
  postedAtText: string;
  freshnessHours: number;
  applyUrl: string;
  sourceUrls: GroundedSource[];
  tier: CompanyTier;
  estimatedCompLPA: string;
  cultureSummary: string;
  keyRequirements: string[];
  minQualificationsMet?: string[];
  minQualificationsMissing?: string[];
  preferredQualificationsMet?: string[];
  preferredQualificationsMissing?: string[];
  yoeAssessment?: string;
  realityVerdict?: string;
  shortlistProbability: number;
  strategicLane: StrategicLane;
  matchReasons: string[];
  gapWarnings: string[];
  status: JobStatus;
  discoveredAt: string;
  appliedAt?: string;
  tailoredResumeId?: string;
}

export interface TailoredResumeVersion {
  id: string;
  jobId: string;
  company: string;
  jobTitle: string;
  versionLabel: string;
  updatedAt: string;
  changeSummary: string[];
  highlightedBulletIndices: number[];
  atsKeywordsMatched: string[];
  resumeData: ResumeData;
}

export interface SweepHistoryItem {
  id: string;
  timestamp: string;
  laneScope: 'all' | 'warmup' | 'faang';
  recencyWindow: RecencyWindow;
  roleFocus: string;
  companiesTargeted: string[];
  jobsAdded: number;
}

export interface WorkspaceState {
  masterResume: ResumeData;
  companies: TargetCompany[];
  jobs: JobOpportunity[];
  tailoredResumes: TailoredResumeVersion[];
  sweepHistory: SweepHistoryItem[];
}

export interface SweepRequest {
  laneScope: 'all' | 'warmup' | 'faang';
  recencyWindow: RecencyWindow;
  roleFocus: string;
  companyIds?: string[];
}
