import { randomUUID } from 'node:crypto';

export const agents = {
  lead: { name: 'Nova', role: 'Strategy lead' },
  design: { name: 'Mira', role: 'Product designer' },
  build: { name: 'Atlas', role: 'Engineer' },
  qa: { name: 'Echo', role: 'Quality analyst' },
};

export function makeWorkspace(brief) {
  const value = typeof brief === 'string' ? brief.trim() : '';
  if (!value || value.length > 500) throw new ClientError(400, 'Brief must be 1–500 characters.');
  return {
    id: randomUUID(), brief: value, nextId: 2,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    tasks: [
      { id: 1, title: 'Shape the approach', description: 'Define scope and success criteria for the brief.', owner: 'lead', status: 'queued', requiresApproval: true },
      { id: 2, title: 'Sketch the experience', description: 'Outline screens, interaction, and visual direction.', owner: 'design', status: 'queued', requiresApproval: false },
      { id: 3, title: 'Plan the implementation', description: 'Break the concept into components and milestones.', owner: 'build', status: 'queued', requiresApproval: false },
      { id: 4, title: 'Review the delivery', description: 'Identify risks and make a launch checklist.', owner: 'qa', status: 'queued', requiresApproval: true },
    ],
    activity: [{ id: 1, agent: 'lead', message: 'Project created. Ready to generate the first deliverable.', time: new Date().toISOString() }],
  };
}

export class ClientError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function entry(workspace, agent, message) {
  workspace.activity.unshift({ id: workspace.nextId++, agent, message, time: new Date().toISOString() });
  workspace.activity = workspace.activity.slice(0, 100);
}

export function nextTask(workspace) {
  if (!workspace) throw new ClientError(404, 'Create a project first.');
  if (workspace.tasks.some(task => task.status === 'review')) throw new ClientError(409, 'Review the pending deliverable first.');
  if (workspace.tasks.some(task => task.status === 'failed')) throw new ClientError(409, 'Retry the failed task first.');
  if (workspace.tasks.some(task => task.status === 'active')) throw new ClientError(409, 'A task is already running.');
  const task = workspace.tasks.find(item => item.status === 'queued');
  if (!task) throw new ClientError(409, 'All tasks are complete.');
  task.status = 'active';
  task.error = undefined;
  entry(workspace, task.owner, `Started ${task.title.toLowerCase()}.`);
  return task;
}

export function completeTask(workspace, task, output) {
  if (task.status !== 'active') throw new ClientError(409, 'Task is not active.');
  task.output = output;
  task.feedback = undefined;
  task.status = task.requiresApproval ? 'review' : 'done';
  entry(workspace, task.owner, task.status === 'review' ? `${task.title} is awaiting your review.` : `${task.title} generated a deliverable.`);
}

export function failTask(workspace, task, error) {
  if (task.status !== 'active') return;
  task.status = 'failed';
  task.error = error;
  entry(workspace, task.owner, `${task.title} failed. Retry when ready.`);
}

export function decide(workspace, taskId, decision, feedback = '') {
  if (!workspace) throw new ClientError(404, 'Create a project first.');
  const task = workspace.tasks.find(item => item.id === taskId);
  if (!task || task.status !== 'review') throw new ClientError(409, 'Task is not awaiting review.');
  if (!['approve', 'revise'].includes(decision)) throw new ClientError(400, 'Invalid decision.');
  if (typeof feedback !== 'string' || feedback.length > 1000) throw new ClientError(400, 'Feedback must be at most 1000 characters.');
  if (decision === 'revise' && !feedback.trim()) throw new ClientError(400, 'Tell the agent what to revise.');
  task.status = decision === 'approve' ? 'done' : 'queued';
  if (decision === 'revise') task.feedback = feedback.trim();
  entry(workspace, task.owner, decision === 'approve' ? `${task.title} approved by you.` : `${task.title} sent back with feedback.`);
  return task;
}

export function retry(workspace, taskId) {
  if (!workspace) throw new ClientError(404, 'Create a project first.');
  const task = workspace.tasks.find(item => item.id === taskId);
  if (!task || task.status !== 'failed') throw new ClientError(409, 'Task has not failed.');
  task.status = 'queued';
  task.error = undefined;
  entry(workspace, task.owner, `${task.title} queued for retry.`);
  return task;
}
