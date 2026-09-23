import { useEffect, useReducer, useState } from 'react';
import OfficeScene from './OfficeScene';
import { agents, createWorkspace, reducer, type AgentId, type TaskStatus } from './workflow';

const columns: { status: TaskStatus; label: string }[] = [
  { status: 'queued', label: 'Queue' },
  { status: 'active', label: 'In progress' },
  { status: 'review', label: 'Your review' },
  { status: 'done', label: 'Complete' },
];

const starterBrief = 'Design a thoughtful landing page for a new productivity tool.';

function Icon({ name }: { name: 'spark' | 'play' | 'pause' | 'step' | 'arrow' }) {
  const paths = {
    spark: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" /><path d="m19 17 .6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17Z" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
    step: <><path d="m6 5 10 7-10 7V5Z" /><path d="M19 5v14" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function App() {
  const [workspace, dispatch] = useReducer(reducer, undefined, () => createWorkspace(starterBrief));
  const [brief, setBrief] = useState('');
  const [selected, setSelected] = useState<AgentId>('lead');
  const [view, setView] = useState<'board' | 'activity'>('board');

  useEffect(() => {
    if (!workspace.running) return;
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 2300);
    return () => window.clearInterval(timer);
  }, [workspace.running]);

  const selectedAgent = agents.find(agent => agent.id === selected)!;
  const selectedTasks = workspace.tasks.filter(task => task.owner === selected);
  const done = workspace.tasks.filter(task => task.status === 'done').length;
  const waiting = workspace.tasks.find(task => task.status === 'review');
  const allDone = done === workspace.tasks.length;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brief.trim()) return;
    dispatch({ type: 'start', brief });
    setSelected('lead');
    setBrief('');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R<span>·</span></span><span className="brand-name">relay<span>office</span><small>AGENT WORKSPACE</small></span></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <button className="nav-item active" onClick={() => setView('board')}><span className="nav-glyph">◈</span> Overview <span className="nav-trail">↗</span></button>
          <button className="nav-item" onClick={() => setView('board')}><span className="nav-glyph">▦</span> Task board <span className="nav-count">{workspace.tasks.length}</span></button>
          <button className="nav-item" onClick={() => setView('activity')}><span className="nav-glyph">≋</span> Activity log <span className="nav-count">{workspace.activity.length}</span></button>
        </nav>
        <div className="sidebar-divider" />
        <div className="side-label side-label-team">YOUR TEAM <span>04</span></div>
        <div className="side-team">
          {agents.map(agent => <button key={agent.id} className={`team-row ${selected === agent.id ? 'team-row-selected' : ''}`} onClick={() => setSelected(agent.id)}>
            <span className="avatar" style={{ '--avatar-color': agent.color } as React.CSSProperties}>{agent.initials}</span>
            <span className="team-name">{agent.name}<small>{agent.role}</small></span>
            <span className={`status-dot ${workspace.tasks.some(task => task.owner === agent.id && task.status === 'active') ? 'busy' : ''}`} />
          </button>)}
        </div>
        <div className="side-bottom"><span className="pulse" /> SIMULATION MODE <small>AI provider connection is coming later</small></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><span className="breadcrumb">Workspace <span>/</span> Overview</span><div className="top-right"><span className="top-live"><span className="pulse" /> LOCAL DEMO</span><span className="top-avatar">DB</span></div></header>
        <div className="content-inner">
          <div className="heading-row"><div><p className="eyebrow">YOUR COMMAND CENTER <span className="eyebrow-rule" /></p><h1>Where ideas <em>take shape.</em></h1><p className="intro">Give your team a direction. Watch the work unfold, one thoughtful step at a time.</p></div><span className="project-number">PROJECT 001 <span>↗</span></span></div>

          <div className="workspace-grid">
            <section className="scene-panel" aria-label="Interactive office preview">
              <div className="panel-top"><div><span className="live-icon">✦</span> THE OFFICE <span className="panel-sub">/ LIVE VIEW</span></div><span className="scene-badge"><span className="pulse" /> {workspace.running ? 'TEAM WORKING' : waiting ? 'AWAITING REVIEW' : allDone ? 'COMPLETE' : 'TEAM READY'}</span></div>
              <OfficeScene workspace={workspace} selected={selected} onSelect={setSelected} />
              <div className="scene-bottom"><span>CLICK AN AGENT TO INSPECT</span><span>ISOMETRIC VIEW <span className="corner-mark">⌗</span></span></div>
            </section>
            <aside className="inspector">
              <div className="inspector-heading"><span>AGENT INSPECTOR</span><span className="inspector-id">0{agents.findIndex(agent => agent.id === selected) + 1} / 04</span></div>
              <div className="inspector-identity"><span className="inspector-avatar" style={{ '--avatar-color': selectedAgent.color } as React.CSSProperties}>{selectedAgent.initials}</span><div><h2>{selectedAgent.name}</h2><span>{selectedAgent.role}</span></div></div>
              <div className="inspector-meta"><span>CURRENT STATUS</span><strong><span className="pulse" /> {selectedTasks.some(task => task.status === 'active') ? 'Working' : selectedTasks.some(task => task.status === 'review') ? 'Needs review' : selectedTasks.every(task => task.status === 'done') ? 'Finished' : 'Standing by'}</strong></div>
              <div className="inspector-section"><span className="section-kicker">ASSIGNMENT</span><p>{selectedTasks[0]?.description}</p></div>
              <div className="inspector-section recent"><span className="section-kicker">LATEST UPDATE</span><p>{workspace.activity.find(entry => entry.agent === selected)?.message ?? 'Waiting for a task to begin.'}</p></div>
              <div className="inspector-foot">AGENT PROFILE <span>↗</span></div>
            </aside>
          </div>

          <section className="brief-card"><div className="brief-heading"><span className="brief-asterisk">✳</span><div><h2>Start with a brief</h2><p>Describe what you want your team to explore.</p></div></div><form onSubmit={submit} className="brief-form"><label className="sr-only" htmlFor="brief">Project brief</label><input id="brief" value={brief} onChange={event => setBrief(event.target.value)} placeholder="e.g. Plan a launch campaign for a new product..." maxLength={500} /><button type="submit" disabled={!brief.trim()}>Start project <Icon name="arrow" /></button></form><div className="brief-note"><strong>Current brief:</strong> {workspace.brief} <span>· New brief resets the simulation. No external API calls are made.</span></div></section>

          <section className="progress-section"><div className="section-head"><div><p className="eyebrow">THE PROCESS</p><h2>{view === 'board' ? 'Work in motion' : 'Recent activity'}</h2></div><div className="section-actions"><span>{done} OF {workspace.tasks.length} COMPLETE</span><button onClick={() => dispatch({ type: 'tick' })} disabled={workspace.running || Boolean(waiting) || allDone} title="Advance one simulation step"><Icon name="step" /> Step</button><button className="run-button" onClick={() => dispatch({ type: 'toggle' })} disabled={Boolean(waiting) || allDone}><Icon name={workspace.running ? 'pause' : 'play'} /> {workspace.running ? 'Pause' : 'Run team'}</button></div></div>
            {view === 'board' ? <div className="task-board">{columns.map(column => <div key={column.status} className="task-column"><div className="column-heading"><span className={`column-indicator ${column.status}`} /> {column.label} <span className="column-count">{workspace.tasks.filter(task => task.status === column.status).length}</span></div><div className="column-body">{workspace.tasks.filter(task => task.status === column.status).map(task => { const agent = agents.find(item => item.id === task.owner)!; return <div className="task-card" key={task.id}><span className="task-id">TASK 0{task.id}</span><h3>{task.title}</h3><p>{task.description}</p><div className="task-owner"><span className="mini-avatar" style={{ '--avatar-color': agent.color } as React.CSSProperties}>{agent.initials}</span>{agent.name}{task.requiresApproval && <span className="approval-symbol" title="Approval required">✳</span>}</div>{task.status === 'review' && <div className="review-actions"><button onClick={() => dispatch({ type: 'revise', taskId: task.id })}>Revise</button><button onClick={() => dispatch({ type: 'approve', taskId: task.id })}>Approve</button></div>}</div>; })}{!workspace.tasks.some(task => task.status === column.status) && <div className="empty-column">Nothing here yet</div>}</div></div>)}</div> : <div className="activity-list">{workspace.activity.map(entry => { const agent = agents.find(item => item.id === entry.agent)!; return <div className="activity-row" key={entry.id}><span className="mini-avatar" style={{ '--avatar-color': agent.color } as React.CSSProperties}>{agent.initials}</span><span><strong>{agent.name}</strong> {entry.message}</span><time>{entry.time}</time></div>; })}</div>}
          </section>
          <footer>RELAY OFFICE <span>·</span> BUILT FOR IDEAS IN MOTION <span className="footer-right">DEMO / 0.1</span></footer>
        </div>
      </main>
    </div>
  );
}
