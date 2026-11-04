import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, getSession, setSession } from '../../api.js';
import { ThemeSwitch } from '../../theme.jsx';
import { Icon, useApi, usePoll } from '../../ui.jsx';

export const can = (role, area) => ({
  complaints: ['helpdesk', 'admin'],
  money: ['accounts', 'admin'],
  report: ['committee', 'accounts', 'helpdesk', 'admin'],
  admin: ['admin'],
}[area].includes(role));
const ROLE_LABEL = { helpdesk: 'Help desk', accounts: 'Accounts', committee: 'Committee', admin: 'Administrator' };

function useCount(path, enabled, pick) {
  const { data, reload } = useApi(enabled ? path : '/me');
  return [enabled && data ? pick(data) : 0, enabled ? reload : () => {}];
}

export default function DeskShell() {
  const user = getSession().user;
  const nav = useNavigate();
  const [late, reloadC] = useCount('/desk/complaints', can(user.role, 'complaints'),
    (l) => l.filter((c) => !['resolved', 'closed'].includes(c.status) && !c.first_response_at && Date.parse(c.due_by) < Date.now()).length);
  const [queue, reloadQ] = useCount('/desk/bank/queue', can(user.role, 'money'), (l) => l.length);
  const [approvals, reloadA] = useCount('/desk/approvals', can(user.role, 'money'), (l) => l.filter((a) => a.requested_by !== user.id).length);
  const refreshCounts = () => { reloadC(); reloadQ(); reloadA(); };
  usePoll(refreshCounts, 20000);

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setSession(null);
    nav('/login', { replace: true });
  }
  return (
    <div className="desk">
      <aside className="side">
        <div className="brand"><img src="/icon.svg" alt="" /><span>Township desk</span></div>
        <nav>
          {can(user.role, 'complaints') && <NavLink to="/desk" end><Icon name="inbox" size={18} />Complaints<span className={`count ${late ? 'alert' : ''}`}>{late ? `${late} late` : ''}</span></NavLink>}
          {can(user.role, 'money') && <>
            <NavLink to="/desk/matching"><Icon name="bank" size={18} />Bank matching<span className="count">{queue || ''}</span></NavLink>
            <NavLink to="/desk/approvals"><Icon name="check" size={18} />Approvals<span className={`count ${approvals ? 'alert' : ''}`}>{approvals || ''}</span></NavLink>
            <NavLink to="/desk/flats"><Icon name="bill" size={18} />Flats & bills</NavLink>
            <NavLink to="/desk/import"><Icon name="upload" size={18} />Import register</NavLink>
            <NavLink to="/desk/tally"><Icon name="download" size={18} />Tally export</NavLink>
          </>}
          {(can(user.role, 'complaints') || can(user.role, 'money')) && <NavLink to="/desk/bookings"><Icon name="clock" size={18} />Bookings</NavLink>}
          {(can(user.role, 'complaints') || can(user.role, 'money')) && <NavLink to="/desk/residents"><Icon name="users" size={18} />Residents</NavLink>}
          {can(user.role, 'report') && <NavLink to="/desk/report"><Icon name="chart" size={18} />Committee report</NavLink>}
          {can(user.role, 'admin') && <NavLink to="/desk/admin"><Icon name="shield" size={18} />Admin</NavLink>}
        </nav>
        <div className="who stack" style={{ gap: 10 }}>
          <ThemeSwitch compact />
          <div><b style={{ fontWeight: 500 }}>{user.name}</b><div className="faint tiny">{ROLE_LABEL[user.role]}</div></div>
          <button className="link small row" style={{ gap: 6 }} onClick={signOut}><Icon name="logout" size={16} />Sign out</button>
        </div>
      </aside>
      <main className="main"><Outlet context={{ refreshCounts }} /></main>
    </div>
  );
}
