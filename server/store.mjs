import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failTask } from './workflow.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const dataFile = join(root, 'projects.json');
export const legacyDataFile = join(root, 'workspace.json');

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validProject(project) {
  return project && typeof project.id === 'string' && typeof project.brief === 'string'
    && Array.isArray(project.tasks) && Array.isArray(project.activity) && Number.isInteger(project.nextId);
}

export async function loadStore(path = dataFile, legacyPath = legacyDataFile) {
  let store = await readJson(path);
  if (!store) {
    const legacy = await readJson(legacyPath);
    if (!legacy) return { activeProjectId: null, projects: [] };
    if (!legacy || !Array.isArray(legacy.tasks) || !Array.isArray(legacy.activity)) {
      throw new Error('Legacy workspace data is invalid. Inspect data/workspace.json.');
    }
    legacy.id ||= randomUUID();
    legacy.createdAt ||= new Date().toISOString();
    legacy.updatedAt ||= legacy.createdAt;
    store = { activeProjectId: legacy.id, projects: [legacy] };
    await saveStore(store, path);
  }
  if (!Array.isArray(store.projects) || !store.projects.every(validProject)
    || (store.activeProjectId !== null && !store.projects.some(project => project.id === store.activeProjectId))
    || new Set(store.projects.map(project => project.id)).size !== store.projects.length) {
    throw new Error('Project data is invalid. Inspect data/projects.json before starting.');
  }
  let recovered = false;
  for (const project of store.projects) {
    for (const task of project.tasks) {
      if (task.status === 'active') {
        failTask(project, task, 'Server stopped while this task was running.');
        project.updatedAt = new Date().toISOString();
        recovered = true;
      }
    }
  }
  if (recovered) await saveStore(store, path);
  return store;
}

export async function saveStore(store, path = dataFile) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function projectSummaries(store) {
  return store.projects
    .map(project => ({
      id: project.id, brief: project.brief, updatedAt: project.updatedAt || project.createdAt || '',
      completed: project.tasks.filter(task => task.status === 'done').length, total: project.tasks.length,
      websiteStage: project.artifact ? 'ready' : project.websiteDraft?.body ? 'page saved' : null,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
