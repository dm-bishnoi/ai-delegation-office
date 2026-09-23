import 'dotenv/config';
import { agents } from './workflow.mjs';

export function providerInfo(env = process.env) {
  const base = env.AI_BASE_URL?.trim();
  const model = env.AI_MODEL?.trim();
  const key = env.AI_API_KEY?.trim();
  return { configured: Boolean(base && model && key && key !== 'your-key-here' && model !== 'your-provider-model-id'), model: model || null };
}

export function providerEndpoint(base) {
  let url;
  try { url = new URL(`${base.replace(/\/+$/, '')}/chat/completions`); }
  catch { throw new Error('AI_BASE_URL must be a valid URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('AI_BASE_URL must use HTTPS, except for a local provider.');
  }
  return url;
}

export async function generate(workspace, task, { env = process.env, fetchImpl = fetch } = {}) {
  if (!providerInfo(env).configured) throw new Error('Set AI_BASE_URL, AI_MODEL, and AI_API_KEY in .env.');
  const url = providerEndpoint(env.AI_BASE_URL.trim());
  const previous = workspace.tasks
    .filter(item => item.id < task.id && item.status === 'done' && item.output)
    .map(item => `${item.title}:\n${item.output.slice(0, 3500)}`)
    .join('\n\n');
  const system = `You are ${agents[task.owner].name}, a ${agents[task.owner].role} in an AI project team. Deliver practical, specific written work for your assigned task. State assumptions, avoid invented research or claims of executed code, and provide a concise artifact the user can review. Output plain text or Markdown. No tool use is available.`;
  const prompt = [
    `Project brief:\n${workspace.brief}`,
    `Your task: ${task.title}. ${task.description}`,
    previous ? `Approved earlier work:\n${previous}` : '',
    task.feedback ? `User revision request:\n${task.feedback}\n\nYour previous draft:\n${(task.output || '').slice(0, 3500)}` : '',
  ].filter(Boolean).join('\n\n');
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY.trim()}` },
      body: JSON.stringify({ model: env.AI_MODEL.trim(), messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.3, max_tokens: 1200 }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw new Error(error?.name === 'TimeoutError' ? 'AI request timed out after 60 seconds.' : 'Could not reach the configured AI provider.');
  }
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}. Check the model and key.`);
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('AI provider returned invalid JSON.'); }
  const output = payload?.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('AI provider returned no text.');
  return output.trim().slice(0, 12000);
}
