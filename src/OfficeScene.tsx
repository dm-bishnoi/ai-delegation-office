import { agents, type AgentId, type Workspace } from './workflow';

interface Props { workspace: Workspace; websiteBuilding: boolean; selected: AgentId; onSelect: (agent: AgentId) => void }

const verbs: Record<AgentId, string> = { lead: 'Interviewing', design: 'Designing', build: 'Building', qa: 'Reviewing' };
const idle: Record<AgentId, string> = { lead: 'Ready to clarify the idea', design: 'Waiting for the brief', build: 'Waiting for approved plans', qa: 'Waiting for a draft' };

function Person({ id, active }: { id: AgentId; active: boolean }) {
  const skin = id === 'build' ? '#b57855' : id === 'qa' ? '#e1b082' : id === 'design' ? '#dfaa81' : '#c18c6d';
  const shirt = id === 'lead' ? '#477463' : id === 'design' ? '#b39c80' : id === 'build' ? '#4f7969' : '#e3d9c1';
  return <svg className={['office-person', active ? 'working' : ''].join(' ')} viewBox="0 0 120 174" role="img" aria-label={agents.find(agent => agent.id === id)?.name + ' at work'}>
    <ellipse cx="62" cy="165" rx="47" ry="6" fill="#131b1b" opacity=".32" />
    <path d="M41 115l-7 42h19l12-40zm32 0 13 42h18l-13-49" fill="#343737" />
    <path d="M30 156h25v8H27zm55 0h24v8H85" fill="#e6d9c5" />
    <path d="M42 70q18-13 42 2l11 48H35z" fill={shirt} stroke="#263433" strokeWidth="3" />
    <path className="office-arm" d="M44 79q-15 14-6 28l21 7" fill="none" stroke={shirt} strokeWidth="14" strokeLinecap="round" />
    <path className="office-hand" d="M79 78q13 13 13 25l-18 5" fill="none" stroke={shirt} strokeWidth="13" strokeLinecap="round" />
    <circle cx="60" cy="40" r="27" fill={skin} />
    <path d="M34 42q-7-31 18-35 29-9 36 19-13-5-18-12-9 15-34 17z" fill={id === 'design' ? '#282321' : id === 'qa' ? '#56453b' : '#262726'} />
    <circle cx="51" cy="41" r="2" fill="#282421" /><circle cx="69" cy="41" r="2" fill="#282421" />
    <path d="M55 52q7 5 13-1" fill="none" stroke="#79543f" strokeWidth="2" strokeLinecap="round" />
    {id === 'qa' && <path d="M43 39h15m3 0h17M58 39h3" fill="none" stroke="#343331" strokeWidth="2" />}
  </svg>;
}

export default function OfficeScene({ workspace, websiteBuilding, selected, onSelect }: Props) {
  return <div className="office-2d" aria-label="Agent activity in a two dimensional office">
    {agents.map(agent => {
      const task = workspace.tasks.find(item => item.owner === agent.id && ['active', 'review', 'failed'].includes(item.status)) || workspace.tasks.find(item => item.owner === agent.id);
      const discovery = agent.id === 'lead' && workspace.discovery && workspace.discovery.status !== 'approved';
      const active = task?.status === 'active' || (agent.id === 'build' && websiteBuilding);
      const message = active ? agent.id === 'build' && websiteBuilding ? 'Writing the website prototype…' : verbs[agent.id] + ' · ' + task?.title.toLowerCase() + '…'
        : discovery ? workspace.discovery?.status === 'review' ? 'Please review the clarified brief.' : 'Tell me about your users and goals.'
        : task?.status === 'review' ? 'Draft ready for your review.' : task?.status === 'failed' ? 'This task needs a retry.'
        : task?.status === 'done' ? 'Approved and saved.' : idle[agent.id];
      return <button type="button" key={agent.id} className={['office-station', 'station-' + agent.id, selected === agent.id ? 'selected' : '', active ? 'is-working' : ''].join(' ')} onClick={() => onSelect(agent.id)} aria-label={'Inspect ' + agent.name + '. ' + message}>
        <div className="office-role"><span className={active ? 'status-on' : ''} />{verbs[agent.id]}<small>{agent.name}</small></div>
        <div className="office-bubble" role="status">{message}</div>
        <div className="office-workspace">
          {agent.id === 'lead' ? <div className="office-board">USERS<br />GOALS<br />NEEDS</div> : agent.id === 'design' ? <div className="office-board wireboard"><span /><span /><span /></div> : <div className="office-screen">{agent.id === 'build' ? <><i />&lt;main&gt;<br />&nbsp; &lt;section&gt;<br />&nbsp; &lt;/section&gt;</> : <>✓ Requirements<br />✓ Review<br />□ Risks</>}</div>}
          <Person id={agent.id} active={Boolean(active)} />
          <div className="office-desk"><span /></div>
        </div>
      </button>;
    })}
    <div className="office-floor" />
  </div>;
}
