export type TaskStatus = 'queued' | 'active' | 'review' | 'done';
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
}

export interface Entry {
  id: number;
  agent: AgentId;
  message: string;
  time: string;
}

export interface Workspace {
  brief: string;
  tasks: Task[];
  activity: Entry[];
  running: boolean;
  nextId: number;
}

export const agents: Agent[] = [
  { id: 'lead', name: 'Nova', role: 'Strategy lead', color: '#d8b783', initials: 'N' },
  { id: 'design', name: 'Mira', role: 'Product designer', color: '#ab9cd7', initials: 'M' },
  { id: 'build', name: 'Atlas', role: 'Engineer', color: '#80b9ad', initials: 'A' },
  { id: 'qa', name: 'Echo', role: 'Quality analyst', color: '#ce987f', initials: 'E' },
];

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function createWorkspace(brief: string): Workspace {
  const clean = brief.trim();
  return {
    brief: clean,
    running: false,
    nextId: 2,
    tasks: [
      { id: 1, title: 'Shape the approach', description: 'Define scope and success criteria for the brief.', owner: 'lead', status: 'queued', requiresApproval: true },
      { id: 2, title: 'Sketch the experience', description: 'Outline screens, interaction, and visual direction.', owner: 'design', status: 'queued', requiresApproval: false },
      { id: 3, title: 'Plan the implementation', description: 'Break the concept into components and milestones.', owner: 'build', status: 'queued', requiresApproval: false },
      { id: 4, title: 'Review the delivery', description: 'Identify risks and make a launch checklist.', owner: 'qa', status: 'queued', requiresApproval: true },
    ],
    activity: [{ id: 1, agent: 'lead', message: 'Project brief received. Team is ready to begin the planning simulation.', time: now() }],
  };
}

export type Action =
  | { type: 'start'; brief: string }
  | { type: 'toggle' }
  | { type: 'tick' }
  | { type: 'approve'; taskId: number }
  | { type: 'revise'; taskId: number };

function log(state: Workspace, agent: AgentId, message: string): Pick<Workspace, 'activity' | 'nextId'> {
  return {
    nextId: state.nextId + 1,
    activity: [{ id: state.nextId, agent, message, time: now() }, ...state.activity].slice(0, 30),
  };
}

export function reducer(state: Workspace, action: Action): Workspace {
  switch (action.type) {
    case 'start':
      return action.brief.trim() ? createWorkspace(action.brief) : state;
    case 'toggle':
      return { ...state, running: !state.running };
    case 'tick': {
      if (!state.brief) return state;
      const active = state.tasks.find(task => task.status === 'active');
      if (active) {
        const status: TaskStatus = active.requiresApproval ? 'review' : 'done';
        const message = status === 'review'
          ? `${active.title} is awaiting your review.`
          : `${active.title} completed in the simulation.`;
        return {
          ...state,
          tasks: state.tasks.map(task => task.id === active.id ? { ...task, status } : task),
          running: status === 'review' ? false : state.running,
          ...log(state, active.owner, message),
        };
      }
      if (state.tasks.some(task => task.status === 'review')) return { ...state, running: false };
      const next = state.tasks.find(task => task.status === 'queued');
      if (!next) return { ...state, running: false };
      return {
        ...state,
        tasks: state.tasks.map(task => task.id === next.id ? { ...task, status: 'active' } : task),
        ...log(state, next.owner, `Started ${next.title.toLowerCase()}.`),
      };
    }
    case 'approve': {
      const task = state.tasks.find(item => item.id === action.taskId && item.status === 'review');
      if (!task) return state;
      return {
        ...state,
        tasks: state.tasks.map(item => item.id === task.id ? { ...item, status: 'done' } : item),
        ...log(state, task.owner, `${task.title} approved by you.`),
      };
    }
    case 'revise': {
      const task = state.tasks.find(item => item.id === action.taskId && item.status === 'review');
      if (!task) return state;
      return {
        ...state,
        tasks: state.tasks.map(item => item.id === task.id ? { ...item, status: 'queued' } : item),
        ...log(state, task.owner, `${task.title} sent back for another pass.`),
      };
    }
  }
}
