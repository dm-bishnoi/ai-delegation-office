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
  tasks: Task[];
  activity: Entry[];
  nextId: number;
  running?: boolean;
  artifact?: { kind: 'website'; filename: string; content: string; createdAt: string; model?: string; attempts?: number };
}

export interface ProjectSummary {
  id: string;
  brief: string;
  updatedAt: string;
  completed: number;
  total: number;
}

export const agents: Agent[] = [
  { id: 'lead', name: 'Nova', role: 'Strategy lead', color: '#d8b783', initials: 'N' },
  { id: 'design', name: 'Mira', role: 'Product designer', color: '#ab9cd7', initials: 'M' },
  { id: 'build', name: 'Atlas', role: 'Engineer', color: '#80b9ad', initials: 'A' },
  { id: 'qa', name: 'Echo', role: 'Quality analyst', color: '#ce987f', initials: 'E' },
];
