import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import OfficeScene from './OfficeScene';
import ProviderSettings from './ProviderSettings';
import { agents, type AgentId, type ProjectSummary, type Task, type TaskStatus, type Workspace } from './workflow';

type Provider = { configured: boolean; model: string | null; name?: string };
type Operation = { type: 'website' | 'task'; projectId: string; model?: string; attempt?: number; total?: number; phase?: 'running' | 'waiting'; delayMs?: number } | null;
type Snapshot = { workspace: Workspace | null; projects: ProjectSummary[]; provider: Provider; busy: boolean; operation: Operation };
const empty: Workspace = { brief: '', tasks: [], activity: [], running: false, nextId: 1 };
const columns: { status: TaskStatus; label: string }[] = [
  { status: 'queued', label: 'Queue' }, { status: 'active', label: 'In progress' },
  { status: 'review', label: 'Your review' }, { status: 'done', label: 'Complete' },
  { status: 'failed', label: 'Needs attention' },
];

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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState('');
  const [brief, setBrief] = useState('');
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<AgentId>('lead');
  const [view, setView] = useState<'board' | 'activity' | 'providers'>('board');
  const [showPreview, setShowPreview] = useState(false);
  const current = workspace ?? empty;

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
    if (busy || !workspace || !provider.configured) return;
    setBusy(true);
    setError('');
    let finished = false;
    const poll = window.setInterval(() => {
      void api<Snapshot>('/api/workspace').then(snapshot => {
        if (!finished && snapshot.workspace?.id === workspace.id) {
          setWorkspace(snapshot.workspace);
          setProjects(snapshot.projects);
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
    } finally { finished = true; window.clearInterval(poll); setBusy(false); }
  }, [busy, workspace, provider.configured]);

  const blocked = current.tasks.some(task => task.status === 'review' || task.status === 'failed');
  const done = current.tasks.filter(task => task.status === 'done').length;
  const allDone = Boolean(workspace) && done === current.tasks.length;
  useEffect(() => {
    if (!auto || busy || blocked || allDone || !workspace) return;
    const timer = window.setTimeout(() => void runStep(), 550);
    return () => window.clearTimeout(timer);
  }, [auto, busy, blocked, allDone, workspace, runStep]);

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

  async function buildWebsite() {
    if (!workspace?.id || busy) return;
    setSelected('build');
    setOperation({ type: 'website', projectId: workspace.id });
    let finished = false;
    const poll = window.setInterval(() => {
      void api<Snapshot>('/api/workspace').then(snapshot => {
        if (!finished && snapshot.workspace?.id === workspace.id) setOperation(snapshot.operation);
      }).catch(() => { /* The build request reports connection errors. */ });
    }, 800);
    try { await mutate('/api/website', { projectId: workspace.id }); }
    finally { finished = true; window.clearInterval(poll); setOperation(null); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brief.trim() || busy) return;
    setAuto(false);
    if (await mutate('/api/projects', { brief })) {
      setBrief(''); setFeedback({}); setSelected('lead'); setShowPreview(false);
    }
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
      setShowPreview(false);
    }
  }

  function downloadWebsite() {
    if (!workspace?.artifact) return;
    const url = URL.createObjectURL(new Blob([workspace.artifact.content], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = workspace.artifact.filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const selectedAgent = agents.find(agent => agent.id === selected)!;
  const selectedTask = current.tasks.find(task => task.owner === selected);
  const recent = current.activity.find(entry => entry.agent === selected);
  const buildingWebsite = operation?.type === 'website' && operation.projectId === workspace?.id;
  const fallbackWaiting = buildingWebsite && operation?.phase === 'waiting';

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
        <div className="project-list" aria-label="Saved projects">{projects.map(project => <button key={project.id} className={`project-row ${project.id === workspace?.id ? 'project-row-selected' : ''}`} title={project.brief} onClick={() => void selectProject(project.id)} disabled={busy}><span className="project-icon">▤</span><span className="project-meta"><strong>{project.brief}</strong><small>{project.completed}/{project.total} complete</small></span></button>)}{!projects.length && <span className="empty-projects">Your projects will appear here.</span>}</div>
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
          {view === 'providers' ? <ProviderSettings busy={busy} onUpdate={async () => {
            const snapshot = await api<Snapshot>('/api/workspace');
            setProvider(snapshot.provider);
          }} /> : <>
          <div className="heading-row"><div><p className="eyebrow">YOUR COMMAND CENTER <span className="eyebrow-rule" /></p><h1>Where ideas <em>take shape.</em></h1><p className="intro">Give your team a direction. Review the written work each agent delivers.</p></div><span className="project-number">PROJECT / LOCAL <span>↗</span></span></div>
          {error && <div className="notice error" role="alert">{error}</div>}
          {!provider.configured && !loading && <div className="notice" role="status">Open <strong>AI connections</strong> in the sidebar to connect a model. You can create a brief now.</div>}

          <div className="workspace-grid">
            <section className="scene-panel" aria-label="Interactive office preview"><div className="panel-top"><div><span className="live-icon">✦</span> THE OFFICE <span className="panel-sub">/ LIVE VIEW</span></div><span className="scene-badge"><span className="pulse" /> {buildingWebsite ? 'ATLAS BUILDING WEBSITE' : busy ? 'WORKING' : blocked ? 'ACTION NEEDED' : allDone ? 'COMPLETE' : 'TEAM READY'}</span></div><OfficeScene workspace={current} websiteBuilding={buildingWebsite} selected={selected} onSelect={setSelected} /><div className="scene-bottom"><span>CLICK AN AGENT TO INSPECT</span><span>ISOMETRIC VIEW <span className="corner-mark">⌗</span></span></div></section>
            <aside className="inspector"><div className="inspector-heading"><span>AGENT INSPECTOR</span><span className="inspector-id">0{agents.findIndex(agent => agent.id === selected) + 1} / 04</span></div><div className="inspector-identity"><span className="inspector-avatar" style={{ '--avatar-color': selectedAgent.color } as CSSProperties}>{selectedAgent.initials}</span><div><h2>{selectedAgent.name}</h2><span>{selectedAgent.role}</span></div></div><div className="inspector-meta"><span>CURRENT STATUS</span><strong><span className="pulse" /> {selected === 'build' && buildingWebsite ? fallbackWaiting ? 'Switching free model' : 'Building website' : selectedTask?.status ?? 'Standing by'}</strong></div><div className="inspector-section"><span className="section-kicker">ASSIGNMENT</span><p>{selected === 'build' && buildingWebsite ? 'Generating a standalone website prototype from the approved project plans.' : selectedTask?.description ?? 'Create a project brief to assign work.'}</p></div><div className="inspector-section recent"><span className="section-kicker">LATEST UPDATE</span><p>{selected === 'build' && buildingWebsite && operation?.model ? `${fallbackWaiting ? 'Waiting before retrying' : 'Using'} ${operation.model} · attempt ${operation.attempt}/${operation.total}.` : recent?.message ?? 'Waiting for a task to begin.'}</p></div><div className="inspector-foot">{selectedTask?.output ? 'DELIVERABLE ON TASK BOARD' : 'SELECT AN AGENT IN THE OFFICE'} <span>↗</span></div></aside>
          </div>

          <section className="brief-card"><div className="brief-heading"><span className="brief-asterisk">✳</span><div><h2>Start with a brief</h2><p>Describe what you want your team to explore.</p></div></div><form onSubmit={submit} className="brief-form"><label className="sr-only" htmlFor="brief">Project brief</label><input id="brief" value={brief} onChange={event => setBrief(event.target.value)} placeholder="e.g. Plan a launch campaign for a new product..." maxLength={500} /><button type="submit" disabled={!brief.trim() || busy}>Start project <Icon name="arrow" /></button></form><div className="brief-note"><strong>Current brief:</strong> {current.brief || 'No project yet.'} <span>· A new brief creates another saved project.</span></div></section>

          <section className="progress-section"><div className="section-head"><div><p className="eyebrow">THE PROCESS</p><h2>{view === 'board' ? 'Work in motion' : 'Recent activity'}</h2></div><div className="section-actions"><span>{done} OF {current.tasks.length} COMPLETE</span><button onClick={() => void runStep()} disabled={!workspace || !provider.configured || busy || blocked || allDone || auto} title="Run one AI task"><Icon name="step" /> Step</button><button className="run-button" onClick={() => setAuto(value => !value)} disabled={!workspace || !provider.configured || blocked || allDone}><Icon name={auto ? 'pause' : 'play'} /> {auto ? 'Pause after task' : 'Run team'}</button></div></div>
            {view === 'board' ? <div className="task-board">{columns.filter(column => column.status !== 'failed' || current.tasks.some(task => task.status === 'failed')).map(column => <div key={column.status} className="task-column"><div className="column-heading"><span className={`column-indicator ${column.status}`} /> {column.label} <span className="column-count">{current.tasks.filter(task => task.status === column.status).length}</span></div><div className="column-body">{current.tasks.filter(task => task.status === column.status).map(task => <div className="task-card" key={task.id}><span className="task-id">TASK 0{task.id}</span><h3>{task.title}</h3><p>{task.description}</p><div className="task-owner"><AgentAvatar id={task.owner} small />{agents.find(agent => agent.id === task.owner)?.name}{task.requiresApproval && <span className="approval-symbol" title="Approval required">✳</span>}</div>{task.output && <details className="task-output" open={task.status === 'review'}><summary>Read {task.feedback ? 'previous draft' : 'deliverable'}</summary><pre>{task.output}</pre></details>}{task.error && <p className="task-error" role="alert">{task.error}</p>}{task.status === 'review' && <div className="review-actions"><label className="sr-only" htmlFor={`feedback-${task.id}`}>Revision feedback</label><textarea id={`feedback-${task.id}`} value={feedback[task.id] || ''} onChange={event => setFeedback(previous => ({ ...previous, [task.id]: event.target.value }))} maxLength={1000} placeholder="What should change? Required to revise." disabled={busy} /><button onClick={() => void decision(task, 'revise')} disabled={busy || !feedback[task.id]?.trim()}>Revise</button><button onClick={() => void decision(task, 'approve')} disabled={busy}>Approve</button></div>}{task.status === 'failed' && <button className="retry-button" onClick={() => void mutate(`/api/tasks/${task.id}/retry`, { projectId: workspace?.id })} disabled={busy}>Retry task</button>}</div>)}{!current.tasks.some(task => task.status === column.status) && <div className="empty-column">Nothing here yet</div>}</div></div>)}</div> : <div className="activity-list">{current.activity.map(entry => <div className="activity-row" key={entry.id}><AgentAvatar id={entry.agent} small /><span><strong>{agents.find(agent => agent.id === entry.agent)?.name}</strong> {entry.message}</span><time>{new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}{!current.activity.length && <div className="empty-column">No activity yet. Create a brief to begin.</div>}</div>}
          </section>
          {workspace && <section className="deliverable-section" aria-labelledby="deliverable-title">
            <div className="deliverable-head"><div><p className="eyebrow">YOUR OUTPUT</p><h2 id="deliverable-title">Project deliverables</h2></div><span>{workspace.artifact ? 'WEBSITE FILE READY' : allDone ? 'PLANS READY · WEBSITE NOT BUILT' : 'WORK IN PROGRESS'}</span></div>
            <p>The four task cards above contain your team's written plans and review. Open each <strong>Read deliverable</strong> to see what was produced. {workspace.artifact ? 'Your website prototype is saved with this local project.' : 'Completing these tasks does not create website code. Generate a prototype after all four are approved.'}</p>
            {allDone && !workspace.artifact && <button className="artifact-button" disabled={busy || !provider.configured} onClick={() => void buildWebsite()}>{fallbackWaiting ? 'Waiting for free model…' : buildingWebsite ? `Building website${operation?.attempt && operation.attempt > 1 ? ` · model ${operation.attempt}/${operation.total}` : ''}…` : 'Generate website prototype'}</button>}
            {workspace.artifact && <div className="artifact-result"><div className="artifact-toolbar"><strong>index.html</strong><div><button onClick={() => setShowPreview(value => !value)}>{showPreview ? 'Hide preview' : 'Preview website'}</button><button onClick={downloadWebsite}>Download code</button></div></div><p>One self-contained HTML file with CSS and optional JavaScript. {workspace.artifact.model && <>Generated with {workspace.artifact.model} (attempt {workspace.artifact.attempts}). </>}Open the downloaded file in a browser or edit it in VS Code. This is an AI-generated draft; review the code before publishing it.</p>{showPreview && <iframe title="Website prototype preview" className="artifact-preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={workspace.artifact.content} />}<details className="artifact-source"><summary>View source code</summary><pre>{workspace.artifact.content}</pre></details></div>}
          </section>}
          </>}
          <footer>RELAY OFFICE <span>·</span> WRITTEN PLANS &amp; WEBSITE PROTOTYPE <span className="footer-right">LOCAL / 0.6.2</span></footer>
        </div>
      </main>
    </div>
  );
}
