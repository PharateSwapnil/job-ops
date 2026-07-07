/**
 * Shared types for the browser automation module.
 */

export const AUTOMATION_PLATFORM_VALUES = [
  "linkedin",
  "naukri",
  "indeed",
  "wellfound",
  "greenhouse",
  "lever",
  "workday",
  "dice",
  "monster",
  "ziprecruiter",
] as const;

export type AutomationPlatform = (typeof AUTOMATION_PLATFORM_VALUES)[number];

export const AUTOMATION_STATUS_VALUES = [
  "idle",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AutomationStatus = (typeof AUTOMATION_STATUS_VALUES)[number];

export const AUTOMATION_STEP_VALUES = [
  "login",
  "search",
  "extract",
  "navigate",
  "fill_form",
  "upload_resume",
  "answer_questions",
  "submit",
  "verify",
  "logout",
] as const;

export type AutomationStep = (typeof AUTOMATION_STEP_VALUES)[number];

export const AUTOMATION_SESSION_STATUS_VALUES = [
  "active",
  "expired",
  "logged_out",
] as const;

export type AutomationSessionStatus =
  (typeof AUTOMATION_SESSION_STATUS_VALUES)[number];

export interface AutomationCredentials {
  platform: AutomationPlatform;
  username: string;
  /** Never logged or returned to client — always stripped server-side */
  password: string;
}

export interface AutomationSearchParams {
  keywords: string;
  location?: string;
  remote?: boolean;
  jobType?: string;
  experienceLevel?: string;
  maxResults?: number;
}

export interface AutomationJobTask {
  id: string;
  tenantId: string;
  userId: string | null;
  jobId: string;
  platform: AutomationPlatform;
  jobUrl: string;
  jobTitle: string;
  employer: string;
  resumeDocumentId: string | null;
  coverLetter: string | null;
  status: AutomationStatus;
  currentStep: AutomationStep | null;
  stepProgress: number;
  screenshotPath: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  enqueuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationSession {
  id: string;
  tenantId: string;
  userId: string | null;
  platform: AutomationPlatform;
  status: AutomationSessionStatus;
  profileDir: string;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationLog {
  id: string;
  taskId: string;
  tenantId: string;
  level: "info" | "warn" | "error";
  message: string;
  meta: string | null;
  createdAt: string;
}

export interface AutomationTaskSummary {
  id: string;
  jobId: string;
  platform: AutomationPlatform;
  jobTitle: string;
  employer: string;
  status: AutomationStatus;
  currentStep: AutomationStep | null;
  stepProgress: number;
  errorMessage: string | null;
  retryCount: number;
  enqueuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AutomationQueueResponse {
  tasks: AutomationTaskSummary[];
  total: number;
  running: number;
  queued: number;
  failed: number;
  completed: number;
}

export interface AutomationEnqueueRequest {
  jobId: string;
  platform: AutomationPlatform;
  resumeDocumentId?: string;
  generateCoverLetter?: boolean;
}

export interface AutomationEnqueueResponse {
  taskId: string;
  jobId: string;
  platform: AutomationPlatform;
  status: AutomationStatus;
  position: number;
}

export interface AutomationTaskDetail extends AutomationJobTask {
  logs: AutomationLog[];
}

export interface AutomationProgressEvent {
  type: "progress" | "step_change" | "screenshot" | "error" | "completed";
  taskId: string;
  status: AutomationStatus;
  currentStep: AutomationStep | null;
  stepProgress: number;
  message?: string;
  screenshotUrl?: string;
  errorMessage?: string | null;
  timestamp: string;
}

export interface AutomationPlatformCapabilities {
  platform: AutomationPlatform;
  label: string;
  supportsEasyApply: boolean;
  supportsResumeUpload: boolean;
  supportsAiQuestions: boolean;
  supportsCoverLetter: boolean;
}

export const AUTOMATION_PLATFORM_CAPABILITIES: Record<
  AutomationPlatform,
  AutomationPlatformCapabilities
> = {
  linkedin: {
    platform: "linkedin",
    label: "LinkedIn",
    supportsEasyApply: true,
    supportsResumeUpload: true,
    supportsAiQuestions: true,
    supportsCoverLetter: true,
  },
  naukri: {
    platform: "naukri",
    label: "Naukri",
    supportsEasyApply: true,
    supportsResumeUpload: true,
    supportsAiQuestions: true,
    supportsCoverLetter: false,
  },
  indeed: {
    platform: "indeed",
    label: "Indeed",
    supportsEasyApply: true,
    supportsResumeUpload: true,
    supportsAiQuestions: true,
    supportsCoverLetter: true,
  },
  wellfound: {
    platform: "wellfound",
    label: "Wellfound",
    supportsEasyApply: false,
    supportsResumeUpload: true,
    supportsAiQuestions: false,
    supportsCoverLetter: true,
  },
  greenhouse: {
    platform: "greenhouse",
    label: "Greenhouse",
    supportsEasyApply: false,
    supportsResumeUpload: true,
    supportsAiQuestions: true,
    supportsCoverLetter: true,
  },
  lever: {
    platform: "lever",
    label: "Lever",
    supportsEasyApply: false,
    supportsResumeUpload: true,
    supportsAiQuestions: true,
    supportsCoverLetter: true,
  },
  workday: {
    platform: "workday",
    label: "Workday",
    supportsEasyApply: false,
    supportsResumeUpload: true,
    supportsAiQuestions: true,
    supportsCoverLetter: false,
  },
  dice: {
    platform: "dice",
    label: "Dice",
    supportsEasyApply: true,
    supportsResumeUpload: true,
    supportsAiQuestions: false,
    supportsCoverLetter: false,
  },
  monster: {
    platform: "monster",
    label: "Monster",
    supportsEasyApply: true,
    supportsResumeUpload: true,
    supportsAiQuestions: false,
    supportsCoverLetter: false,
  },
  ziprecruiter: {
    platform: "ziprecruiter",
    label: "ZipRecruiter",
    supportsEasyApply: true,
    supportsResumeUpload: true,
    supportsAiQuestions: false,
    supportsCoverLetter: false,
  },
};
