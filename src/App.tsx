import { Suspense, lazy, useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import ProviderSettings from './ProviderSettings';
import { agents, type AgentId, type ProjectSummary, type Task, type TaskStatus, type Workspace } from './workflow';
const OfficeScene = lazy(() => import('./OfficeScene'));

type Provider = { configured: boolean; model: string | null; name?: string };
type Operation = { type: 'website' | 'task' | 'discovery' | 'research'; projectId: string; agent?: AgentId; model?: string; attempt?: number; total?: number; phase?: 'running' | 'waiting'; delayMs?: number; readyAt?: number | null; deadlineAt?: number | null; stage?: string; stageNumber?: number; stageTotal?: number; previousModel?: string | null; switchReason?: string | null } | null;
type Snapshot = { workspace: Workspace | null; projects: ProjectSummary[]; provider: Provider; researchSearchConfigured: boolean; busy: boolean; operation: Operation };
const empty: Workspace = { brief: '', tasks: [], activity: [], running: false, nextId: 1 };
const columns: { status: TaskStatus; label: string }[] = [
  { status: 'queued', label: 'Queue' }, { status: 'active', label: 'In progress' },
  { status: 'review', label: 'Your review' }, { status: 'done', label: 'Complete' },
  { status: 'failed', label: 'Needs attention' },
];
const questions = [
  { key: 'audience', label: 'Who will use this? What do you know about them?' },
  { key: 'problem', label: 'What problem do they face today?' },
  { key: 'outcome', label: 'What should the first version achieve?' },
  { key: 'constraints', label: 'Deadline, budget, platform or other constraints? Say “not decided” if unknown.' },
];
const followUps = [
  { key: 'scope', label: 'What must the first version include, and what can wait?' },
  { key: 'success', label: 'How will you tell that the first version worked?' },
];

function downloadText(filename: string, content: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function api<T>(path: string, data?: object): Promise<T> {
  const response = await fetch(path, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload as T;
}

function Icon({ name }: { name: 'play' | 'pause' | 'step' | 'arrow' }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
    step: <><path d="m6 5 10 7-10 7V5Z" /><path d="M19 5v14" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function AgentAvatar({ id, small = false }: { id: AgentId; small?: boolean }) {
  const agent = agents.find(item => item.id === id)!;
  return <span className={small ? 'mini-avatar' : 'avatar'} style={{ '--avatar-color': agent.color } as CSSProperties}>{agent.initials}</span>;
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [provider, setProvider] = useState<Provider>({ configured: false, model: null });
  const [researchSearchConfigured, setResearchSearchConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [now, setNow] = useState(() => Date.now());
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState('');
  const [brief, setBrief] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const askedStages = useRef(new Set<string>());
  const [websiteFeedback, setWebsiteFeedback] = useState('');
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<AgentId>('lead');
  type Intent = { kind: 'create' | 'update' | 'ambiguous'; prompt: string; reason: string; projectId?: string; projectTitle?: string };
  const [intent, setIntent] = useState<Intent | null>(null);
  const [routing, setRouting] = useState(false);
  const [activityScope, setActivityScope] = useState<'current' | 'all'>('current');
  const [view, setView] = useState<'board' | 'activity' | 'providers'>(() => new URLSearchParams(window.location.search).get('view') === 'providers' ? 'providers' : 'board');
  const [showPreview, setShowPreview] = useState(false);
  const current = workspace ?? empty;
  useEffect(() => {
    if (!operation || !['waiting', 'running'].includes(operation.phase || '')) return;
    setNow(Date.now());
    const ticker = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(ticker);
  }, [operation?.phase, operation?.readyAt, operation?.deadlineAt]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function refresh() {
      try {
        const snapshot = await api<Snapshot>('/api/workspace');
        if (cancelled) return;
        setWorkspace(snapshot.workspace);
        setProjects(snapshot.projects);
        setProvider(snapshot.provider);
        setResearchSearchConfigured(snapshot.researchSearchConfigured);
        setBusy(snapshot.busy);
        setOperation(snapshot.operation);
        if (snapshot.busy) timer = window.setTimeout(() => void refresh(), 1000);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not connect to the local API.');
      } finally { if (!cancelled) setLoading(false); }
    }
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  const runStep = useCallback(async () => {
    if (busy || !workspace || (!provider.configured && !(workspace.mode === 'consultancy' && !researchSearchConfigured && workspace.tasks[0]?.status === 'queued'))) return;
    setBusy(true);
    setError('');
    let finished = false;
    const poll = window.setInterval(() => {
      void api<Snapshot>('/api/workspace').then(snapshot => {
        if (!finished && snapshot.workspace?.id === workspace.id) {
          setWorkspace(snapshot.workspace);
          setProjects(snapshot.projects);
          setOperation(snapshot.operation);
        }
      }).catch(() => { /* The task request reports the connection error. */ });
    }, 450);
    try {
      const result = await api<Snapshot>('/api/steps', { projectId: workspace.id });
      setWorkspace(result.workspace);
      setProjects(result.projects);
      setOperation(result.operation);
      if (result.workspace?.tasks.some(task => task.status === 'failed' || task.status === 'review')) setAuto(false);
    } catch (cause) {
      setAuto(false);
      setError(cause instanceof Error ? cause.message : 'Could not run this task.');
    } finally { finished = true; window.clearInterval(poll); setOperation(null); setBusy(false); }
  }, [busy, workspace, provider.configured, researchSearchConfigured]);

  const blocked = current.tasks.some(task => task.status === 'review' || task.status === 'failed');
  const discoveryReady = current.mode !== 'consultancy' || current.discovery?.status === 'approved';
  const canRun = Boolean(provider.configured || (current.mode === 'consultancy' && !researchSearchConfigured && current.tasks[0]?.status === 'queued'));
  const done = current.tasks.filter(task => task.status === 'done').length;
  const allDone = Boolean(workspace) && done === current.tasks.length;
  const websiteFailure = allDone && !workspace?.artifact && Boolean(workspace?.websiteError) && !busy;
  useEffect(() => {
    if (!auto || busy || blocked || allDone || !workspace || !discoveryReady) return;
    const timer = window.setTimeout(() => void runStep(), 550);
    return () => window.clearTimeout(timer);
  }, [auto, busy, blocked, allDone, workspace, discoveryReady, runStep]);

  async function mutate(path: string, data: object) {
    setBusy(true);
    setError('');
    try {
      const result = await api<Snapshot>(path, data);
      setWorkspace(result.workspace);
      setProjects(result.projects);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
      return false;
    } finally { setBusy(false); }
  }

  const askQuestions = useCallback(async (projectId: string) => {
    setBusy(true);
    setError('');
    let finished = false;
    const poll = window.setInterval(() => {
      void api<Snapshot>('/api/workspace').then(snapshot => {
        if (!finished && snapshot.workspace?.id === projectId) setOperation(snapshot.operation);
      }).catch(() => { /* The questions request reports the connection error. */ });
    }, 800);
    try {
      const result = await api<Snapshot>('/api/discovery/questions', { projectId });
      if (result.workspace?.id === projectId) { setWorkspace(result.workspace); setProjects(result.projects); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare questions. Your answers are safe.');
    } finally { finished = true; window.clearInterval(poll); setOperation(null); setBusy(false); }
  }, []);

  useEffect(() => {
    const discovery = workspace?.discovery;
    const stage = discovery?.status;
    if (loading || busy || !provider.configured || !workspace?.id || (stage !== 'questions' && stage !== 'followup')) return;
    if (stage === 'questions' && (discovery?.questions?.length || questions.some(item => discovery?.answers[item.key]?.trim()))) return;
    if (stage === 'followup' && (discovery?.followUpQuestions?.length || followUps.some(item => discovery?.answers[item.key]?.trim()))) return;
    const key = `${workspace.id}:${stage}`;
    if (askedStages.current.has(key)) return;
    askedStages.current.add(key);
    void askQuestions(workspace.id);
  }, [workspace, loading, busy, provider.configured, askQuestions]);

  async function buildWebsite() {
    if (!workspace?.id || busy) return;
    setSelected('build');
    setOperation({ type: 'website', projectId: workspace.id });
    let finished = false;
    const poll = window.setInterval(() => {
      void api<Snapshot>('/api/workspace').then(snapshot => {
        if (!finished && snapshot.workspace?.id === workspace.id) {
          setWorkspace(snapshot.workspace);
          setProjects(snapshot.projects);
          setOperation(snapshot.operation);
        }
      }).catch(() => { /* The build request reports connection errors. */ });
    }, 800);
    try { await mutate('/api/website', { projectId: workspace.id }); }
    finally {
      finished = true;
      window.clearInterval(poll);
      setOperation(null);
      try {
        const snapshot = await api<Snapshot>('/api/workspace');
        setWorkspace(snapshot.workspace);
        setProjects(snapshot.projects);
      } catch { /* The earlier request has already reported the error. */ }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brief.trim() || busy) return;
    setAuto(false);
    setError('');
    setRouting(true);
    try {
      const { routing } = await api<{ routing: { intent: 'new_project' | 'update_project' | 'ambiguous'; targetProjectId: string | null; reason: string } }>('/api/prompts/route', { prompt: brief });
      if (routing.intent === 'new_project') {
        setIntent({ kind: 'create', prompt: brief, reason: routing.reason });
      } else if (routing.intent === 'update_project' && routing.targetProjectId) {
        const target = projects.find(project => project.id === routing.targetProjectId);
        setIntent({ kind: 'update', prompt: brief, projectId: routing.targetProjectId, projectTitle: target?.brief.slice(0, 70) || 'the selected project', reason: routing.reason });
      } else {
        setIntent({ kind: 'ambiguous', prompt: brief, reason: routing.reason });
      }
    } catch {
      // Routing is unavailable (older API process, network trouble, bad response):
      // never mutate anything and never surface a misleading route error. Keep
      // the prompt pending and let the user choose explicitly.
      setIntent({ kind: 'ambiguous', prompt: brief, reason: 'Automatic prompt routing is unavailable right now. Choose how to continue — nothing has been saved or changed.' });
    } finally { setRouting(false); }
  }

  async function confirmIntent() {
    if (!intent || busy) return;
    if (intent.kind === 'create') {
      // Create first: POST /api/projects makes the new project and returns it as
      // the active workspace in one snapshot. No existing project id is used or
      // required; on failure mutate() shows a truthful error and the previous
      // project remains selected and rendered.
      if (await mutate('/api/projects', { brief: intent.prompt })) {
        setBrief(''); setIntent(null); setAnswers({}); setFeedback({}); setSelected('lead'); setShowPreview(false);
      }
      return;
    }
    if (intent.kind === 'update') {
      if (await mutate('/api/projects/route-change', { projectId: intent.projectId, prompt: intent.prompt })) {
        setBrief('');
        const projectId = intent.projectId;
        setIntent(null);
        if (workspace?.id !== projectId) await mutate(`/api/projects/${projectId}/select`, {});
      }
    }
  }

  async function applyChangeRequest(projectId: string, requestId: string) {
    if (await mutate(`/api/projects/${projectId}/change-requests/${requestId}/apply`, {})) setIntent(null);
  }

  async function decision(task: Task, value: 'approve' | 'revise') {
    const success = await mutate(`/api/tasks/${task.id}/decision`, { projectId: workspace?.id, decision: value, feedback: feedback[task.id] || '' });
    if (success) setFeedback(previous => ({ ...previous, [task.id]: '' }));
  }

  async function selectProject(id: string) {
    if (busy || id === workspace?.id) return;
    setAuto(false);
    if (await mutate(`/api/projects/${id}/select`, {})) {
      setSelected('lead');
      setFeedback({});
      setAnswers({});
      setShowPreview(false);
      setView('board');
    }
  }

  function downloadWebsite() {
    if (!workspace?.artifact) return;
    downloadText(workspace.artifact.filename, workspace.artifact.content, 'text/html');
  }

  const selectedAgent = agents.find(agent => agent.id === selected)!;
  const selectedTask = current.tasks.find(task => task.owner === selected && ['active', 'review', 'failed'].includes(task.status)) || current.tasks.find(task => task.owner === selected && task.status === 'queued') || current.tasks.find(task => task.owner === selected);
  const recent = current.activity.find(entry => entry.agent === selected);
  const buildingWebsite = operation?.type === 'website' && operation.projectId === workspace?.id;
  const fallbackWaiting = buildingWebsite && operation?.phase === 'waiting';
  const countdownTo = operation?.phase === 'waiting' ? operation.readyAt : operation?.deadlineAt;
  const remainingSeconds = countdownTo ? Math.max(0, Math.ceil((countdownTo - now) / 1000)) : 0;
  const discoveryStage = workspace?.discovery?.status;
  const tailoredQuestions = discoveryStage === 'followup' ? workspace?.discovery?.followUpQuestions : workspace?.discovery?.questions;
  const activeQuestions = tailoredQuestions?.length ? tailoredQuestions : (discoveryStage === 'followup' ? followUps : questions).map(item => ({ key: item.key, question: item.label, options: [] }));
  const stageHasAnswers = (discoveryStage === 'followup' ? followUps : questions).some(item => Boolean(workspace?.discovery?.answers[item.key]?.trim() || answers[item.key]?.trim()));
  const resumeTarget = !discoveryReady ? 'discovery-title' : allDone ? 'deliverable-title' : 'process-title';
  const pendingChangeRequest = current.changeRequests?.find(item => item.status === 'awaiting_approval');
  const allActivity = activityScope === 'all'
    ? projects.flatMap(project => (project.recentActivity || []).map((entry, index) => ({ ...entry, key: `${project.id}-${entry.time}-${index}`, projectId: project.id, projectTitle: project.brief })))
      .sort((a, b) => b.time.localeCompare(a.time)).slice(0, 60)
    : null;
  const resumeLabel = !discoveryReady ? discoveryStage === 'review' ? 'Review clarified brief' : 'Continue discovery' : current.tasks.some(task => task.status === 'failed') ? 'Retry unfinished task' : current.tasks.some(task => task.status === 'review') ? 'Review saved draft' : allDone ? workspace?.artifact ? 'Open saved website' : workspace?.websiteDraft?.body ? 'Continue saved website' : workspace?.websiteError ? 'Retry website' : 'Review saved deliverables' : 'Continue next task';
  function resumeProject() {
    setView('board');
    window.requestAnimationFrame(() => document.getElementById(resumeTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    if (allDone && workspace?.artifact) setShowPreview(true);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R<span>·</span></span><span className="brand-name">relay<span>office</span><small>AGENT WORKSPACE</small></span></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <button className={`nav-item ${view === 'board' ? 'active' : ''}`} onClick={() => setView('board')}><span className="nav-glyph">◈</span> Task board <span className="nav-count">{current.tasks.length}</span></button>
          <button className={`nav-item ${view === 'activity' ? 'active' : ''}`} onClick={() => setView('activity')}><span className="nav-glyph">≋</span> Activity log <span className="nav-count">{current.activity.length}</span></button>
          <button className={`nav-item ${view === 'providers' ? 'active' : ''}`} onClick={() => { setAuto(false); setView('providers'); }}><span className="nav-glyph">◎</span> AI connections <span className="nav-count">{provider.configured ? '●' : '○'}</span></button>
        </nav>
        <div className="sidebar-divider" />
        <div className="side-label side-label-team">PROJECTS <span>{String(projects.length).padStart(2, '0')}</span></div>
        <div className="project-list" aria-label="Saved projects">{projects.map(project => <button key={project.id} className={`project-row ${project.id === workspace?.id ? 'project-row-selected' : ''}`} title={project.brief} onClick={() => void selectProject(project.id)} disabled={busy}><span className="project-icon">▤</span><span className="project-meta"><strong>{project.brief}</strong><small>{project.completed}/{project.total} complete{project.websiteStage ? ` · ${project.websiteStage}` : ''}</small></span></button>)}{!projects.length && <span className="empty-projects">Your projects will appear here.</span>}</div>
        <div className="sidebar-divider" />
        <div className="side-label side-label-team">YOUR TEAM <span>04</span></div>
        <div className="side-team">{agents.map(agent => <button key={agent.id} className={`team-row ${selected === agent.id ? 'team-row-selected' : ''}`} onClick={() => setSelected(agent.id)}>
          <AgentAvatar id={agent.id} /><span className="team-name">{agent.name}<small>{agent.role}</small></span>
          <span className={`status-dot ${current.tasks.some(task => task.owner === agent.id && task.status === 'active') || (agent.id === 'build' && buildingWebsite) ? 'busy' : ''}`} />
        </button>)}</div>
        <div className="side-bottom"><span className="pulse" /> {provider.configured ? 'AI PROVIDER READY' : 'AI SETUP REQUIRED'}<small>{provider.configured ? `${provider.name} · ${provider.model}` : 'Open AI connections to set up'}</small></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><span className="breadcrumb">Workspace <span>/</span> {view === 'board' ? 'Overview' : view === 'activity' ? 'Activity' : 'AI connections'}</span><div className="top-right"><label className="sr-only" htmlFor="mobile-project">Select project</label><select id="mobile-project" className="mobile-project-select" value={workspace?.id || ''} onChange={event => void selectProject(event.target.value)} disabled={busy || !projects.length}><option value="" disabled>Projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.brief}</option>)}</select><span className="top-live"><span className="pulse" /> LOCAL WORKSPACE</span><span className="top-avatar">DB</span></div></header>
        <div className="content-inner">
          {view === 'providers' ? <ProviderSettings busy={busy} notice={new URLSearchParams(window.location.search).get('openrouter') || ''} onUpdate={async () => {
            const snapshot = await api<Snapshot>('/api/workspace');
            setProvider(snapshot.provider);
          }} /> : <>
          <div className="heading-row"><div><p className="eyebrow">YOUR COMMAND CENTER <span className="eyebrow-rule" /></p><h1>Where ideas <em>take shape.</em></h1><p className="intro">Clarify your idea, review the evidence and approve each saved deliverable.</p></div><span className="project-number">PROJECT / LOCAL <span>↗</span></span></div>
          {(error || websiteFailure) && <div className="notice error" role="alert"><span>{error || workspace?.websiteError}</span>{websiteFailure && <button type="button" className="notice-retry" onClick={() => void buildWebsite()} disabled={!provider.configured}>Retry website{workspace?.websiteDraft?.body ? ' from saved page' : ''}</button>}</div>}
          {operation?.phase === 'waiting' && <div className="notice" role="status">{operation.switchReason ? `${operation.previousModel ? `${operation.previousModel} ${operation.switchReason}` : 'Previous model ' + operation.switchReason} · switching to ${operation.model}` : `Switching to ${operation.model}`} in {remainingSeconds}s · attempt {operation.attempt}/{operation.total}{operation.stageNumber ? ` · website stage ${operation.stageNumber}/${operation.stageTotal}` : operation.type === 'discovery' ? ' · preparing questions' : ''}. Saved progress stays with this project.</div>}
          {operation?.phase === 'running' && operation.projectId === workspace?.id && <div className="notice" role="status">Using {operation.model} · attempt {operation.attempt}/{operation.total}{operation.stageNumber ? ` · website stage ${operation.stageNumber}/${operation.stageTotal}` : operation.type === 'discovery' ? ' · preparing questions' : ''} · timeout in {remainingSeconds}s. Your saved answers are safe.</div>}
          {!provider.configured && !loading && <div className="notice" role="status">Open <strong>AI connections</strong> to connect a model for written deliverables. Discovery and an offline research plan can be saved now.</div>}

          <div className="workspace-grid">
            <section className="scene-panel" aria-label="Interactive office preview"><div className="panel-top"><div><span className="live-icon">✦</span> THE OFFICE <span className="panel-sub">/ LIVE VIEW</span></div><span className="scene-badge"><span className="pulse" /> {operation?.phase === 'waiting' ? buildingWebsite ? 'ATLAS WAITING TO RETRY' : 'WAITING TO RETRY' : buildingWebsite ? 'ATLAS BUILDING WEBSITE' : operation?.type === 'research' ? 'RESEARCH IN PROGRESS' : operation?.type === 'discovery' ? 'NOVA PREPARING QUESTIONS' : operation?.type === 'task' ? 'TASK IN PROGRESS' : !discoveryReady ? 'DISCOVERY' : blocked ? 'ACTION NEEDED' : allDone ? 'COMPLETE' : 'TEAM READY'}</span></div><Suspense fallback={<div className="office-3d-loading" role="status">Loading the office…</div>}><OfficeScene workspace={current} operation={operation} selected={selected} onSelect={setSelected} /></Suspense><div className="scene-bottom"><span>SELECT A PERSON TO INSPECT</span><span>3D OFFICE · SAVED TASK STATES</span></div></section>
            <aside className="inspector"><div className="inspector-heading"><span>AGENT INSPECTOR</span><span className="inspector-id">0{agents.findIndex(agent => agent.id === selected) + 1} / 04</span></div><div className="inspector-identity"><span className="inspector-avatar" style={{ '--avatar-color': selectedAgent.color } as CSSProperties}>{selectedAgent.initials}</span><div><h2>{selectedAgent.name}</h2><span>{selectedAgent.role}</span></div></div><div className="inspector-meta"><span>CURRENT STATUS</span><strong><span className="pulse" /> {selected === 'build' && buildingWebsite ? fallbackWaiting ? 'Switching free model' : 'Building website' : selectedTask?.status ?? 'Standing by'}</strong></div><div className="inspector-section"><span className="section-kicker">ASSIGNMENT</span><p>{selected === 'build' && buildingWebsite ? 'Generating a standalone website prototype from the approved project plans.' : selectedTask?.description ?? 'Create a project brief to assign work.'}</p></div><div className="inspector-section recent"><span className="section-kicker">LATEST UPDATE</span><p>{selected === 'build' && buildingWebsite && operation?.model ? `${fallbackWaiting ? 'Waiting before retrying' : 'Using'} ${operation.model} · attempt ${operation.attempt}/${operation.total}.` : recent?.message ?? 'Waiting for a task to begin.'}</p></div><div className="inspector-foot">{selectedTask?.output ? 'DELIVERABLE ON TASK BOARD' : 'SELECT AN AGENT IN THE OFFICE'} <span>↗</span></div></aside>
          </div>

          {workspace && <section className="project-resume" aria-label="Saved project checkpoint"><div><span className="section-kicker">SAVED PROJECT · {done}/{current.tasks.length} TASKS COMPLETE</span><strong>{current.brief}</strong><small>{workspace.artifact ? 'Website file saved with this project' : current.websiteDraft ? 'Website draft checkpoint saved' : !discoveryReady ? 'Your discovery answers are saved' : 'Completed stages and drafts are saved'}</small></div><button type="button" onClick={resumeProject} disabled={busy}>{resumeLabel} <Icon name="arrow" /></button></section>}
          <section className="brief-card"><div className="brief-heading"><span className="brief-asterisk">✳</span><div><h2>Start with a brief</h2><p>Describe a new idea, or a change to the selected project.</p></div></div><form onSubmit={submit} className="brief-form"><label className="sr-only" htmlFor="brief">Project prompt</label><input id="brief" value={brief} onChange={event => setBrief(event.target.value)} placeholder="e.g. Plan a launch campaign… or “Add Stripe billing to this project”" maxLength={500} /><button type="submit" disabled={!brief.trim() || busy || routing}>{routing ? 'Reading…' : 'Continue'} <Icon name="arrow" /></button></form><div className="brief-note"><strong>Current project:</strong> {current.brief || 'None selected.'} <span>· New ideas create a project; change requests are confirmed first.</span></div></section>

          {intent && <section className="intent-card" aria-live="polite">
            {intent.kind === 'create' && <>
              <span className="intent-badge">Create new project</span>
              <p><strong>“{intent.prompt.slice(0, 120)}{intent.prompt.length > 120 ? '…' : ''}”</strong> reads as a new, self-contained idea. The current projects stay untouched; the new project starts with discovery questions.</p>
              <div className="intent-actions"><button onClick={() => void confirmIntent()} disabled={busy}>Create new project</button><button className="intent-secondary" onClick={() => setIntent(null)} disabled={busy}>Cancel</button></div>
            </>}
            {intent.kind === 'update' && <>
              <span className="intent-badge update">Change request · {intent.projectTitle}</span>
              <p><strong>“{intent.prompt.slice(0, 120)}{intent.prompt.length > 120 ? '…' : ''}”</strong> will be proposed as a change to <strong>{intent.projectTitle}</strong>. Nothing is modified until you review the impact. {intent.reason}</p>
              <div className="intent-actions"><button onClick={() => void confirmIntent()} disabled={busy}>Prepare change proposal</button><button className="intent-secondary" onClick={() => setIntent(null)} disabled={busy}>Cancel</button></div>
            </>}
            {intent.kind === 'ambiguous' && <>
              <span className="intent-badge">What do you want to do?</span>
              <p><strong>“{intent.prompt.slice(0, 120)}{intent.prompt.length > 120 ? '…' : ''}”</strong> could create a new project or change an existing one. {intent.reason}</p>
              <div className="intent-actions">
                <button onClick={() => setIntent({ ...intent, kind: 'create' })} disabled={busy}>Create a new project</button>
                {workspace && <button onClick={() => setIntent({ ...intent, kind: 'update', projectId: workspace.id, projectTitle: current.brief.slice(0, 70) })} disabled={busy}>Update: {current.brief.slice(0, 40)}{current.brief.length > 40 ? '…' : ''}</button>}
                {projects.filter(project => project.id !== workspace?.id).slice(0, 2).map(project => <button key={project.id} className="intent-secondary" onClick={() => setIntent({ ...intent, kind: 'update', projectId: project.id, projectTitle: project.brief.slice(0, 70) })} disabled={busy}>Update: {project.brief.slice(0, 36)}{project.brief.length > 36 ? '…' : ''}</button>)}
                <button className="intent-secondary" onClick={() => setIntent(null)} disabled={busy}>Cancel</button>
              </div>
            </>}
          </section>}

          {pendingChangeRequest && <section className="change-request-card" aria-labelledby="cr-title">
            <span className="intent-badge update">Change request awaiting approval</span>
            <h3 id="cr-title">{pendingChangeRequest.proposedChanges.summary}</h3>
            <p>Requested: “{pendingChangeRequest.prompt}”</p>
            <div className="cr-impact">
              <div><span className="section-kicker">PROPOSED IMPACT</span>
                <ul>{['research', 'requirements', 'design', 'review'].map(stage => <li key={stage}>
                  {pendingChangeRequest.proposedChanges.impactedStages.includes(stage) ? `✔ ${stage[0].toUpperCase()}${stage.slice(1)}: update task will be added` : `${stage[0].toUpperCase()}${stage.slice(1)}: unchanged`}
                </li>)}</ul>
              </div>
              <div><span className="section-kicker">HISTORY</span><p>Completed tasks, approved deliverables, and saved website versions are never overwritten. Approved changes add new update tasks.</p></div>
            </div>
            <div className="intent-actions">
              <button onClick={() => void applyChangeRequest(current.id!, pendingChangeRequest.id)} disabled={busy}>Approve changes</button>
              <button className="intent-secondary" onClick={() => void mutate(`/api/projects/${current.id}/change-requests/${pendingChangeRequest.id}/cancel`, {})} disabled={busy}>Cancel</button>
            </div>
          </section>}

          {workspace?.mode === 'consultancy' && <section className="consultancy-section" aria-labelledby="discovery-title"><p className="eyebrow">DISCOVER → RESEARCH → REQUIREMENTS → DESIGN → REVIEW</p><h2 id="discovery-title">Understand the project</h2>
            {['questions', 'followup'].includes(workspace.discovery?.status || '') && <form className="discovery-form" onSubmit={async event => { event.preventDefault(); if (await mutate('/api/discovery/answers', { projectId: workspace.id, answers: { ...workspace.discovery?.answers, ...answers } })) setAnswers({}); }}>
              <p>{discoveryStage === 'followup' ? 'Nova uses your saved answers to clarify scope and success.' : 'Nova asks about your project idea. Save answers at any time; constraints may be “not decided”.'} {tailoredQuestions?.length ? 'Choose a suggestion or write your own answer.' : 'Guided questions are available while Nova prepares tailored questions.'}</p>
              {provider.configured && <button type="button" className="question-refresh" disabled={busy || stageHasAnswers} onClick={() => { askedStages.current.add(`${workspace.id}:${discoveryStage}`); void askQuestions(workspace.id!); }}>{busy && operation?.type === 'discovery' ? 'Nova is preparing questions…' : tailoredQuestions?.length ? 'Refresh suggestions' : 'Ask Nova project-specific questions'}</button>}
              <div className="question-grid">{activeQuestions.map(question => <div className="question-field" key={question.key}><label htmlFor={`discovery-${question.key}`}>{question.question}</label>
                {question.options.length > 0 && <div className="question-options" aria-label={`Suggestions for ${question.question}`}>{question.options.map(option => <button key={option} type="button" aria-pressed={(answers[question.key] ?? workspace.discovery?.answers[question.key] ?? '') === option} onClick={() => setAnswers(previous => ({ ...previous, [question.key]: option }))} disabled={busy}>{option}</button>)}</div>}
                <textarea id={`discovery-${question.key}`} maxLength={500} value={answers[question.key] ?? workspace.discovery?.answers[question.key] ?? ''} onChange={event => setAnswers(previous => ({ ...previous, [question.key]: event.target.value }))} placeholder="Write your own answer or edit a suggestion" disabled={busy} /></div>)}</div>
              <button type="submit" disabled={busy}>{discoveryStage === 'followup' ? 'Save and review clarified brief' : 'Save answers and continue'}</button></form>}
            {workspace.discovery?.status === 'review' && <div className="brief-review"><p>Read the clarified brief before the team starts work.</p><pre>{workspace.discovery.brief}</pre><div className="review-actions"><button onClick={() => void mutate('/api/discovery/decision', { projectId: workspace.id, decision: 'revise' })} disabled={busy}>Edit answers</button><button onClick={() => void mutate('/api/discovery/decision', { projectId: workspace.id, decision: 'approve' })} disabled={busy}>Approve brief</button></div></div>}
            {workspace.discovery?.status === 'approved' && <details><summary>Approved brief · read or download</summary><pre>{workspace.discovery.brief}</pre><button onClick={() => downloadText('PROJECT_BRIEF.md', workspace.discovery?.brief || '')}>Download brief</button></details>}
          </section>}

          <section className="progress-section"><div className="section-head"><div><p className="eyebrow">THE PROCESS</p><h2 id="process-title">{view === 'board' ? 'Work in motion' : 'Recent activity'}</h2></div><div className="section-actions"><span>{done} OF {current.tasks.length} COMPLETE</span><button onClick={() => void runStep()} disabled={!workspace || !canRun || !discoveryReady || busy || blocked || allDone || auto} title="Run one AI task"><Icon name="step" /> Step</button><button className="run-button" onClick={() => setAuto(value => !value)} disabled={!workspace || !canRun || !discoveryReady || blocked || allDone}><Icon name={auto ? 'pause' : 'play'} /> {auto ? 'Pause after task' : 'Run team'}</button></div></div>
            {view === 'board' ? !workspace ? <div className="empty-column board-empty">No project selected. Start a brief below or pick a saved project from the sidebar.</div> : <div className="task-board">{columns.filter(column => column.status !== 'failed' || current.tasks.some(task => task.status === 'failed')).map(column => <div key={column.status} className="task-column"><div className="column-heading"><span className={`column-indicator ${column.status}`} /> {column.label} <span className="column-count">{current.tasks.filter(task => task.status === column.status).length}</span></div><div className="column-body">{current.tasks.filter(task => task.status === column.status).map(task => <div className="task-card" key={task.id}><span className="task-id">TASK 0{task.id}</span><h3>{task.title}</h3><p>{task.description}</p><div className="task-owner"><AgentAvatar id={task.owner} small />{agents.find(agent => agent.id === task.owner)?.name}{task.requiresApproval && <span className="approval-symbol" title="Approval required">✳</span>}</div>{task.output && <details className="task-output" open={task.status === 'review'}><summary>Read {task.feedback ? 'previous draft' : 'deliverable'}</summary><pre>{task.output}</pre></details>}{Boolean(task.revisions?.length) && <details className="task-output"><summary>Earlier drafts ({task.revisions?.length})</summary>{task.revisions?.map((revision, index) => <div key={index}><small>Replaced {new Date(revision.replacedAt).toLocaleString()}</small><pre>{revision.content}</pre></div>)}</details>}{task.error && <p className="task-error" role="alert">{task.error}</p>}{task.status === 'review' && <div className="review-actions"><label className="sr-only" htmlFor={`feedback-${task.id}`}>Revision feedback</label><textarea id={`feedback-${task.id}`} value={feedback[task.id] || ''} onChange={event => setFeedback(previous => ({ ...previous, [task.id]: event.target.value }))} maxLength={1000} placeholder="What should change? Required to revise." disabled={busy} /><button onClick={() => void decision(task, 'revise')} disabled={busy || !feedback[task.id]?.trim()}>Revise</button><button onClick={() => void decision(task, 'approve')} disabled={busy}>Approve</button></div>}{task.status === 'failed' && <button className="retry-button" onClick={() => void mutate(`/api/tasks/${task.id}/retry`, { projectId: workspace?.id })} disabled={busy}>Retry task</button>}</div>)}{!current.tasks.some(task => task.status === column.status) && <div className="empty-column">Nothing here yet</div>}</div></div>)}</div> : <div className="activity-list"><div className="activity-scope" role="group" aria-label="Activity scope"><button className={activityScope === 'current' ? 'active' : ''} onClick={() => setActivityScope('current')} aria-pressed={activityScope === 'current'}>Current project</button><button className={activityScope === 'all' ? 'active' : ''} onClick={() => setActivityScope('all')} aria-pressed={activityScope === 'all'}>All projects</button></div>
              {activityScope === 'current' && <>{current.activity.map(entry => <div className="activity-row" key={entry.id}><AgentAvatar id={entry.agent} small /><span><strong>{agents.find(agent => agent.id === entry.agent)?.name}</strong> {entry.message}</span><time>{new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}{!current.activity.length && <div className="empty-column">No activity yet. Create a brief to begin.</div>}</>}
              {allActivity !== null && <>{allActivity.map(entry => <div className="activity-row" key={entry.key}><AgentAvatar id={entry.agent} small /><span><strong>{agents.find(agent => agent.id === entry.agent)?.name}</strong> {entry.message}<small className="activity-project">{entry.projectTitle.slice(0, 50)}{entry.projectTitle.length > 50 ? '…' : ''}</small></span><time>{new Date(entry.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>)}{!allActivity.length && <div className="empty-column">No activity in any project yet.</div>}</>}
            </div>}
          </section>
          {workspace && <section className="deliverable-section" aria-labelledby="deliverable-title">
            <div className="deliverable-head"><div><p className="eyebrow">YOUR OUTPUT</p><h2 id="deliverable-title">Project deliverables</h2></div><span>{workspace.artifact ? 'WEBSITE FILE READY' : allDone ? 'PLANS READY · WEBSITE NOT BUILT' : 'WORK IN PROGRESS'}</span></div>
            <p>The task cards contain saved work and reviews. Open <strong>Read deliverable</strong> for each draft. {workspace.artifact ? 'Your website prototype is saved with this project.' : 'Approve the proposal before choosing whether to generate website code.'}</p>
            {workspace.research && <div className="research-result"><h3>Research record</h3><p>{workspace.research.status === 'snippets' ? 'Live search excerpts. Links and snippets are leads; underlying pages have not been verified.' : workspace.research.status === 'unavailable' ? 'No live search configured. The research task produces an explicitly labeled plan, not findings.' : 'The live search returned no usable sources.'}</p>{workspace.research.searchedAt && <small>Searched {new Date(workspace.research.searchedAt).toLocaleString()}</small>}<ul>{workspace.research.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p>{source.excerpt}</p></li>)}</ul></div>}
            {workspace.designPreview && <div className="design-result"><div className="artifact-toolbar"><strong>Design wireframe {workspace.designPreview.stale ? '· revision requested' : ''}</strong><button onClick={() => downloadText(workspace.designPreview!.filename, workspace.designPreview!.content, 'text/html')}>Download wireframe</button></div><p>Structural concept generated from the brief and the design draft. Review the written deliverable for the full rationale.</p><iframe title="Design wireframe" className="artifact-preview" sandbox="" referrerPolicy="no-referrer" srcDoc={workspace.designPreview.content} /></div>}
            {workspace.mode === 'consultancy' && <div className="project-docs"><h3>Project documentation</h3><p>Download the approved brief, requirements and review. These are working documents; open decisions remain visible in the drafts.</p><div className="doc-links">{[['PROJECT_BRIEF.md', workspace.discovery?.brief], ['RESEARCH.md', workspace.tasks[0]?.output], ['PRD.md', workspace.tasks[1]?.output], ['DESIGN_SYSTEM.md', workspace.tasks[2]?.output], ['REVIEW.md', workspace.tasks[3]?.output]].map(([name, content]) => content && <button key={name} onClick={() => downloadText(name || 'document.md', content)}>{name} ↓</button>)}</div></div>}
            {workspace.websiteDraft?.body && !workspace.artifact && <div className="draft-progress"><strong>Website page saved · stage 1 of 2</strong><p>Page content is saved with this project. Select this project later to continue with styling; your approved plans stay saved.</p><iframe title="Saved website draft" className="artifact-preview" sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${workspace.websiteDraft.css || 'body{font-family:system-ui;margin:2rem;line-height:1.5}'}</style></head><body>${workspace.websiteDraft.body}</body></html>`} /><details><summary>View saved page HTML</summary><pre>{workspace.websiteDraft.body}</pre></details></div>}
            {allDone && !workspace.artifact && <button className="artifact-button" disabled={busy || !provider.configured} onClick={() => void buildWebsite()}>{fallbackWaiting ? `Next model in ${remainingSeconds}s…` : buildingWebsite ? `Building ${operation?.stage === 'css' ? 'styles' : 'page'} · stage ${operation?.stageNumber || 1}/2…` : workspace.websiteError ? `Retry website${workspace.websiteDraft?.body ? ' from saved page' : ''}` : workspace.websiteDraft?.body ? 'Continue website from saved page' : 'Generate website prototype'}</button>}
            {workspace.artifact && <div className="artifact-result"><div className="artifact-toolbar"><strong>index.html · version {workspace.artifact.version || 1}</strong><div><button onClick={() => setShowPreview(value => !value)}>{showPreview ? 'Hide preview' : 'Preview website'}</button><button onClick={downloadWebsite}>Download code</button></div></div><p>One self-contained HTML file with CSS and optional JavaScript. {workspace.artifact.model && <>Generated with {workspace.artifact.model} (attempt {workspace.artifact.attempts}). </>}Open it in a browser or edit it in VS Code. Review the generated draft before publishing.</p>{showPreview && <iframe title="Website prototype preview" className="artifact-preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={workspace.artifact.content} />}<details className="artifact-source"><summary>View source code</summary><pre>{workspace.artifact.content}</pre></details><div className="revision-form"><label htmlFor="website-feedback">Request a website revision</label><textarea id="website-feedback" value={websiteFeedback} onChange={event => setWebsiteFeedback(event.target.value)} maxLength={800} placeholder="Describe what should change in the next version" /><button disabled={busy || !websiteFeedback.trim()} onClick={async () => { if (await mutate('/api/website/revise', { projectId: workspace.id, feedback: websiteFeedback })) setWebsiteFeedback(''); }}>Save feedback and prepare next version</button></div></div>}
            {Boolean(workspace.artifactVersions?.length) && <details className="version-history"><summary>Previous website versions ({workspace.artifactVersions?.length})</summary>{workspace.artifactVersions?.map((version, index) => version && <div key={index}><strong>Version {version.version || index + 1}</strong> · {new Date(version.createdAt).toLocaleString()} <button onClick={() => downloadText(`website-v${version.version || index + 1}.html`, version.content, 'text/html')}>Download</button></div>)}</details>}
          </section>}
          </>}
          <footer>RELAY OFFICE <span>·</span> WRITTEN PLANS &amp; WEBSITE PROTOTYPE <span className="footer-right">LOCAL / 0.8.0</span></footer>
        </div>
      </main>
    </div>
  );
}
