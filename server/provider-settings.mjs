import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerEndpoint, providerInfo } from './provider.mjs';
import { isOpenRouter } from './free-models.mjs';

const dataDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const settingsFile = join(dataDirectory, 'providers.json');
export const keyFile = join(dataDirectory, 'provider.key');

async function encryptionKey(path, create) {
  try { return await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    await mkdir(dirname(path), { recursive: true });
    try { await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
    return readFile(path);
  }
}

async function encrypt(value, path) {
  const key = await encryptionKey(path, true);
  if (key.length !== 32) throw new Error('Local provider encryption key is invalid.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

async function decrypt(value, path) {
  const key = await encryptionKey(path, false);
  if (key.length !== 32) throw new Error('Local provider encryption key is invalid.');
  const parts = value.split('.').map(part => Buffer.from(part, 'base64url'));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) throw new Error('Saved provider credential is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', key, parts[0]);
  decipher.setAuthTag(parts[1]);
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8');
}

export async function loadProviderSettings(path = settingsFile) {
  try {
    const settings = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(settings.providers) || !settings.providers.every(item => typeof item.id === 'string' && typeof item.credential === 'string')
      || (settings.activeId !== null && !settings.providers.some(item => item.id === settings.activeId))) {
      throw new Error('Saved provider settings are invalid.');
    }
    return settings;
  } catch (error) {
    if (error.code === 'ENOENT') return { activeId: null, providers: [] };
    throw error;
  }
}

export async function saveProviderSettings(settings, path = settingsFile) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function publicProviderSettings(settings, env = process.env) {
  const fallback = providerInfo(env);
  const active = settings.providers.find(item => item.id === settings.activeId);
  let fallbackUrl = 'Configured in .env';
  try {
    const url = new URL(env.AI_BASE_URL);
    if (!url.username && !url.password && !url.search && !url.hash) fallbackUrl = url.href.replace(/\/$/, '');
  } catch { /* A malformed configuration is shown only as a generic label. */ }
  return {
    activeId: active?.id || (fallback.configured ? 'env' : null),
    providers: [
      ...(fallback.configured ? [{ id: 'env', name: 'Environment (.env)', baseUrl: fallbackUrl, model: fallback.model, hasKey: true,
        freeFallback: isOpenRouter(env.AI_BASE_URL) && env.AI_FREE_FALLBACK?.trim().toLowerCase() !== 'false' }] : []),
      ...settings.providers.map(({ id, name, baseUrl, model, credential, freeFallback }) => ({ id, name, baseUrl, model,
        hasKey: Boolean(credential), freeFallback: isOpenRouter(baseUrl) && freeFallback !== false })),
    ],
  };
}

export function activeProviderInfo(settings, env = process.env) {
  const active = settings.providers.find(item => item.id === settings.activeId);
  return active ? { configured: true, model: active.model, name: active.name } : { ...providerInfo(env), name: 'Environment (.env)' };
}

export async function activeProviderEnv(settings, env = process.env, secretPath = keyFile) {
  const active = settings.providers.find(item => item.id === settings.activeId);
  if (!active) return env;
  return { ...env, AI_BASE_URL: active.baseUrl, AI_MODEL: active.model,
    AI_API_KEY: active.credential ? await decrypt(active.credential, secretPath) : 'local-no-key',
    AI_LOCAL_NO_KEY: active.credential ? 'false' : 'true',
    AI_FREE_FALLBACK: isOpenRouter(active.baseUrl) && active.freeFallback !== false ? 'true' : 'false' };
}

export async function saveProvider(settings, input, path = settingsFile, secretPath = keyFile) {
  const { name, baseUrl, model, apiKey, freeFallback } = input || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 60
    || typeof baseUrl !== 'string' || baseUrl.length > 250
    || typeof model !== 'string' || !model.trim() || model.length > 160
    || typeof apiKey !== 'string' || apiKey.length > 500) throw new Error('Enter a provider name, API URL, and model.');
  const url = providerEndpoint(baseUrl.trim());
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/chat/completions')) throw new Error('API URL must be a clean OpenAI-compatible API prefix.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !apiKey.trim()) throw new Error('An API key is required for a remote provider.');
  const provider = { id: randomUUID(), name: name.trim(), baseUrl: baseUrl.trim().replace(/\/+$/, ''),
    model: model.trim(), credential: apiKey.trim() ? await encrypt(apiKey.trim(), secretPath) : '',
    freeFallback: isOpenRouter(baseUrl.trim()) && freeFallback !== false };
  const updated = { activeId: provider.id, providers: [...settings.providers, provider] };
  await saveProviderSettings(updated, path);
  return updated;
}

export function setProviderFallback(settings, id, enabled) {
  const provider = settings.providers.find(item => item.id === id);
  if (!provider || !isOpenRouter(provider.baseUrl) || typeof enabled !== 'boolean') throw new Error('OpenRouter provider not found or invalid fallback choice.');
  return { ...settings, providers: settings.providers.map(item => item.id === id ? { ...item, freeFallback: enabled } : item) };
}

export function selectProvider(settings, id, env = process.env) {
  if (id === 'env' && providerInfo(env).configured) return { ...settings, activeId: null };
  if (!settings.providers.some(item => item.id === id)) throw new Error('Provider not found.');
  return { ...settings, activeId: id };
}

export function removeProvider(settings, id) {
  if (!settings.providers.some(item => item.id === id)) throw new Error('Provider not found.');
  return { activeId: settings.activeId === id ? null : settings.activeId,
    providers: settings.providers.filter(item => item.id !== id) };
}
