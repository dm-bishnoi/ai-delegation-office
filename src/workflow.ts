export type TaskStatus = 'queued' | 'active' | 'review' | 'done' | 'failed';
export type AgentId = 'lead' | 'design' | 'build' | 'qa';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  color: string;
  initials: string;
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
  discovery?: { status: 'questions' | 'followup' | 'review' | 'approved'; answers: Record<string, string>; brief: string };
  research?: { status: 'unavailable' | 'empty' | 'snippets'; searchedAt: string | null; reason?: string; query?: string; sources: { title: string; url: string; excerpt: string }[] };
  designPreview?: { filename: string; content: string; kind: string; createdAt: string; stale?: boolean };
  tasks: Task[];
  activity: Entry[];
  nextId: number;
  running?: boolean;
  artifact?: { kind: 'website'; filename: string; content: string; createdAt: string; model?: string; attempts?: number; version?: number; files?: { filename: string; content: string }[] };
  artifactVersions?: Workspace['artifact'][];
  websiteFeedback?: string;
  websiteDraft?: { body?: string; css?: string; model?: string; attempts?: number };
  websiteError?: string;
}

export interface ProjectSummary {
  id: string;
  brief: string;
  updatedAt: string;
  completed: number;
  total: number;
  websiteStage?: string | null;
}

export const agents: Agent[] = [
  { id: 'lead', name: 'Nova', role: 'Strategy lead', color: '#d8b783', initials: 'N' },
  { id: 'design', name: 'Mira', role: 'Product designer', color: '#ab9cd7', initials: 'M' },
  { id: 'build', name: 'Atlas', role: 'Engineer', color: '#80b9ad', initials: 'A' },
  { id: 'qa', name: 'Echo', role: 'Quality analyst', color: '#ce987f', initials: 'E' },
];
