import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failTask } from './workflow.mjs';

export const dataFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'workspace.json');

export async function loadWorkspace(path = dataFile) {
  let workspace;
  try { workspace = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!workspace || !Array.isArray(workspace.tasks) || !Array.isArray(workspace.activity)) {
    throw new Error('Workspace data is invalid. Inspect data/workspace.json before starting.');
  }
  let recovered = false;
  for (const task of workspace.tasks) {
    if (task.status === 'active') {
      failTask(workspace, task, 'Server stopped while this task was running.');
      recovered = true;
    }
  }
  if (recovered) await saveWorkspace(workspace, path);
  return workspace;
}

export async function saveWorkspace(workspace, path = dataFile) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(workspace, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
