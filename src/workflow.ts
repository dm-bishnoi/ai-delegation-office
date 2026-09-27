export type TaskStatus = 'queued' | 'active' | 'review' | 'done' | 'failed';
export type AgentId = 'lead' | 'design' | 'build' | 'qa';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  color: string;
  initials: string;
}

export interface ProviderAttempt {
  attempt: number;
  requestedModel: string;
  responseModel: string | null;
  httpStatus: number | null;
  errorClass: string;
  finishReason: string | null;
  requestedMaxTokens: number;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; reasoningTokens: number | null } | null;
  contentState: string;
  reason: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  owner: AgentId;
  status: TaskStatus;
  requiresApproval: boolean;
  output?: string;
  error?: string;
  feedback?: string;
  approvedAt?: string;
  revisions?: { content: string; replacedAt: string }[];
  providerAttempts?: ProviderAttempt[];
}

export interface Entry {
  id: number;
  agent: AgentId;
  message: string;
  time: string;
}

export interface Workspace {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  brief: string;
  mode?: 'consultancy';
  discovery?: { status: 'questions' | 'followup' | 'review' | 'approved'; answers: Record<string, string>; brief: string;
    questions?: DiscoveryQuestion[]; followUpQuestions?: DiscoveryQuestion[]; questionModel?: string; followUpModel?: string; questionAttempts?: ProviderAttempt[] };
  research?: { status: 'unavailable' | 'empty' | 'snippets'; searchedAt: string | null; reason?: string; query?: string; sources: { title: string; url: string; excerpt: string }[] };
  designPreview?: { filename: string; content: string; kind: string; createdAt: string; stale?: boolean };
  tasks: Task[];
  activity: Entry[];
  changeRequests?: ChangeRequest[];
  nextId: number;
  running?: boolean;
  artifact?: { kind: 'website'; filename: string; content: string; createdAt: string; model?: string; attempts?: number; version?: number; files?: { filename: string; content: string }[] };
  artifactVersions?: Workspace['artifact'][];
  websiteFeedback?: string;
  websiteDraft?: { body?: string; css?: string; model?: string; attempts?: number };
  websiteError?: string;
  websiteAttempts?: ProviderAttempt[];
}

export interface DiscoveryQuestion { key: string; question: string; options: string[] }

export interface ChangeRequest {
  id: string;
  projectId: string;
  prompt: string;
  createdAt: string;
  status: 'draft' | 'awaiting_approval' | 'approved' | 'applied' | 'cancelled';
  proposedChanges: { summary: string; impactedStages: string[]; reopenTaskIds: number[] };
  createdTaskIds: number[];
}

export interface ProjectSummary {
  id: string;
  brief: string;
  updatedAt: string;
  completed: number;
  total: number;
  websiteStage?: string | null;
  recentActivity?: { agent: AgentId; message: string; time: string }[];
  pendingChangeRequests?: number;
}

export const agents: Agent[] = [
  { id: 'lead', name: 'Nova', role: 'Strategy lead', color: '#d8b783', initials: 'N' },
  { id: 'design', name: 'Mira', role: 'Product designer', color: '#ab9cd7', initials: 'M' },
  { id: 'build', name: 'Atlas', role: 'Engineer', color: '#80b9ad', initials: 'A' },
  { id: 'qa', name: 'Echo', role: 'Quality analyst', color: '#ce987f', initials: 'E' },
];
