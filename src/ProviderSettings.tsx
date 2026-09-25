import { useEffect, useState, type FormEvent } from 'react';

type SavedProvider = { id: string; name: string; baseUrl: string; model: string; hasKey: boolean; freeFallback: boolean };
type Settings = { activeId: string | null; providers: SavedProvider[] };
type Preset = 'openrouter' | 'openai' | 'ollama' | 'custom';
const presets: Record<Preset, { label: string; name: string; baseUrl: string; model: string }> = {
  openrouter: { label: 'OpenRouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },
  openai: { label: 'OpenAI', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  ollama: { label: 'Ollama (local)', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: '' },
  custom: { label: 'OpenAI-compatible', name: 'Custom provider', baseUrl: '', model: '' },
};

async function request<T>(path: string, data?: object): Promise<T> {
  const response = await fetch(path, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload as T;
}

export default function ProviderSettings({ busy, onUpdate }: { busy: boolean; onUpdate: () => Promise<void> }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [preset, setPreset] = useState<Preset>('openrouter');
  const [name, setName] = useState(presets.openrouter.name);
  const [baseUrl, setBaseUrl] = useState(presets.openrouter.baseUrl);
  const [model, setModel] = useState(presets.openrouter.model);
  const [apiKey, setApiKey] = useState('');
  const [freeFallback, setFreeFallback] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => { void request<Settings>('/api/providers').then(setSettings).catch(cause => setError(cause.message)); }, []);

  function choose(value: Preset) {
    setPreset(value);
    setName(presets[value].name);
    setBaseUrl(presets[value].baseUrl);
    setModel(presets[value].model);
    setApiKey('');
    setFreeFallback(value === 'openrouter');
    setModels([]);
    setError('');
    setStatus('');
  }

  async function change(action: () => Promise<Settings>, message: string) {
    setSaving(true); setError(''); setStatus('');
    try {
      setSettings(await action());
      await onUpdate();
      setStatus(message);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Provider request failed.'); return false; }
    finally { setSaving(false); }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await change(() => request<Settings>('/api/providers', { name, baseUrl, model, apiKey, freeFallback }), 'Provider saved and selected. Run Test connection before creating a project.')) setApiKey('');
  }

  async function test(id: string) {
    setSaving(true); setError(''); setStatus('');
    try {
      const result = await request<{ check: 'credentials' | 'generation'; freeRemaining?: number | null }>('/api/providers/test', { id });
      setStatus(result.check === 'credentials'
        ? `OpenRouter API key is valid.${result.freeRemaining === 0 ? ' No free requests remain today.' : ''} Model generation has not been tested.`
        : 'Connection works. The selected model returned a short AI response.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Connection test failed.'); }
    finally { setSaving(false); }
  }

  async function loadModels() {
    setSaving(true); setError(''); setStatus('');
    try {
      const result = await request<{ models: string[] }>('/api/providers/models', { baseUrl, apiKey });
      setModels(result.models);
      setStatus(`${result.models.length} model IDs loaded. Choose a model or type another ID.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load models.'); }
    finally { setSaving(false); }
  }

  return <section className="provider-settings" aria-labelledby="provider-title">
    <p className="eyebrow">YOUR WORKSPACE</p>
    <h1 id="provider-title">AI connections</h1>
    <p className="intro">Connect a model for your team's plans and website prototype. The selected provider handles the next AI request.</p>
    {error && <div className="notice error" role="alert">{error}</div>}
    {status && <div className="notice" role="status">{status}</div>}
    <div className="provider-layout">
      <div className="provider-panel">
        <h2>Connected providers</h2>
        <p>Keys stay on the local Node server. An existing <code>.env</code> setup remains available.</p>
        {settings?.providers.map(item => <div className="provider-row" key={item.id}>
          <div><strong>{item.name}</strong><small>{item.model} · {item.baseUrl}</small><span>{settings.activeId === item.id ? 'ACTIVE' : 'INACTIVE'}{item.baseUrl === presets.openrouter.baseUrl ? ` · FREE FALLBACK ${item.freeFallback ? 'ON' : 'OFF'}` : ''}</span></div>
          <div className="provider-actions">
            {settings.activeId !== item.id && <button disabled={busy || saving} onClick={() => void change(() => request<Settings>('/api/providers/select', { id: item.id }), 'Provider selected.')}>Use</button>}
            {settings.activeId === item.id && <button disabled={busy || saving} onClick={() => void test(item.id)}>{item.baseUrl === presets.openrouter.baseUrl ? 'Check API key' : 'Test connection'}</button>}
            {item.id !== 'env' && item.baseUrl === presets.openrouter.baseUrl && <button disabled={busy || saving} onClick={() => void change(() => request<Settings>('/api/providers/fallback', { id: item.id, enabled: !item.freeFallback }), `Free-model fallback ${item.freeFallback ? 'disabled' : 'enabled'}.`)}>{item.freeFallback ? 'Disable fallback' : 'Enable fallback'}</button>}
            {item.id !== 'env' && <button disabled={busy || saving} onClick={() => void change(() => request<Settings>('/api/providers/remove', { id: item.id }), 'Provider removed.')} aria-label={`Remove ${item.name}`}>Remove</button>}
          </div>
        </div>)}
        {!settings?.providers.length && <p>No provider connected yet.</p>}
        <p className="provider-hint">OpenRouter's key check validates your key without running a model. Other providers use a short AI request that may count toward quota. Neither check guarantees that a model can return a complete website. Free fallback applies only to exact OpenRouter connections and retries up to two verified zero-cost models after rate limits and recoverable errors; account-wide limits, invalid credentials, and configuration errors still require attention.</p>
      </div>
      <form className="provider-panel provider-form" onSubmit={event => void add(event)}>
        <h2>Add a provider</h2>
        <label>Provider<select value={preset} onChange={event => choose(event.target.value as Preset)}>{Object.entries(presets).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
        <label>Connection name<input value={name} onChange={event => setName(event.target.value)} required maxLength={60} /></label>
        <label>API base URL<input value={baseUrl} onChange={event => { setBaseUrl(event.target.value); setModels([]); }} placeholder="https://provider.example/v1" required maxLength={250} spellCheck={false} /></label>
        <label>Model ID<input list="available-models" value={model} onChange={event => setModel(event.target.value)} placeholder="Exact model identifier" required maxLength={160} spellCheck={false} /><datalist id="available-models">{models.map(id => <option key={id} value={id} />)}</datalist></label>
        <label>API key {preset === 'ollama' && <span>(optional for local models)</span>}<input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} required={preset !== 'ollama'} maxLength={500} placeholder="Stored only on your local server" /></label>
        {baseUrl.replace(/\/+$/, '') === presets.openrouter.baseUrl && <label className="provider-checkbox"><input type="checkbox" checked={freeFallback} onChange={event => setFreeFallback(event.target.checked)} /> Switch to up to two verified free models after rate limits or recoverable errors</label>}
        <button className="provider-model-button" type="button" onClick={() => void loadModels()} disabled={saving || busy || !baseUrl || (preset !== 'ollama' && !apiKey)}>Load model IDs</button>
        <button className="provider-submit" type="submit" disabled={saving || busy}>Save and select provider</button>
        <p className="provider-hint">Remote connections use HTTPS. Local Ollama accepts HTTP. Free models can have daily limits; choosing a paid provider may incur charges.</p>
      </form>
    </div>
  </section>;
}
