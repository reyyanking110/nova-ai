import React, { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  AudioLines,
  Bell,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  CreditCard,
  Download,
  FileText,
  Filter,
  Globe2,
  LayoutDashboard,
  Link2,
  Loader2,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { personalOnly, toolSchemas } from '@nova/shared';
import { api, supabase, setSession, streamReply } from './api';
import './styles.css';
type Row = Record<string, any>;
type Mode = 'all' | 'personal' | 'business';
const navigation = [
  { label: 'Overview', icon: LayoutDashboard, section: 'WORKSPACE' },
  { label: 'Conversations', icon: MessageCircle },
  { label: 'Contacts', icon: Users },
  { label: 'AI Settings', icon: Sparkles, section: 'INTELLIGENCE' },
  { label: 'Memory', icon: Brain },
  { label: 'Tasks', icon: CheckCircle2 },
  { label: 'Reminders', icon: Bell },
  { label: 'Documents', icon: FileText },
  { label: 'Business Profiles', icon: BookOpen, section: 'MANAGEMENT' },
  { label: 'Tool Permissions', icon: ShieldCheck },
  { label: 'Usage and Costs', icon: CreditCard },
  { label: 'Activity Logs', icon: Activity },
  { label: 'Integrations', icon: Link2 },
  { label: 'Account Settings', icon: Settings2 },
];
const subtitles: Record<string, string> = {
  Overview: 'A clear view of your assistant. Everything, in one place.',
  Conversations: 'Every conversation, with context that stays connected.',
  Contacts: 'The people at the heart of your workspace.',
  Memory: 'Useful context. Remembered with your permission.',
  Tasks: 'Turn a conversation into a little progress.',
  Reminders: 'The right nudge, at the right time.',
  Documents: 'Your knowledge, ready for a conversation.',
  'AI Settings': 'Make NOVA sound and think a little more like you.',
  'Business Profiles': 'Give your assistant the context to represent your business.',
  'Tool Permissions': 'You decide what your assistant can do.',
  'Usage and Costs': 'Understand your usage. Stay in control.',
  'Activity Logs': 'A transparent record of what happens in your workspace.',
  Integrations: 'The connections that bring your assistant to life.',
  'Account Settings': 'Your identity, preferences, and private workspace.',
};
const formatDate = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
function Badge({ children, green = false }: { children: React.ReactNode; green?: boolean }) {
  return <span className={`badge ${green ? 'green' : ''}`}>{children}</span>;
}
function Empty({
  icon: Icon = MessageCircle,
  title,
  description,
  action,
}: {
  icon?: typeof MessageCircle;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handle);
    const prev = document.activeElement as HTMLElement;
    document.querySelector<HTMLButtonElement>('.modal .close')?.focus();
    return () => {
      window.removeEventListener('keydown', handle);
      prev?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const nodes = e.currentTarget.querySelectorAll<HTMLElement>(
            'button,input,select,textarea,a[href]',
          );
          const first = nodes[0],
            last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="panel-head">
          <h2>{title}</h2>
          <button className="icon-button close" onClick={close} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function App() {
  const [ready, setReady] = useState(false),
    [signed, setSigned] = useState(false),
    [page, setPage] = useState(location.hash.slice(1) || 'Overview'),
    [mode, setMode] = useState<Mode>('all'),
    [search, setSearch] = useState(''),
    [mobile, setMobile] = useState(false),
    [profile, setProfile] = useState<Row>({}),
    [notice, setNotice] = useState(''),
    [help, setHelp] = useState(false);
  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSigned(!!data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setSigned(!!s);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (signed)
      api('/me')
        .then(setProfile)
        .catch((e) => setNotice(e.message));
  }, [signed]);
  useEffect(() => {
    const onHash = () => {
      const value = decodeURIComponent(location.hash.slice(1));
      setPage(navigation.some((n) => n.label === value) ? value : 'Overview');
      setSearch('');
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.searchbox input')?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault();
        location.hash = 'Overview';
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  function go(name: string) {
    location.hash = name;
    setMobile(false);
  }
  if (!ready)
    return (
      <div className="loading-screen">
        <Loader2 className="spin" /> Loading your workspace
      </div>
    );
  if (supabase && !signed) return <Login />;
  const shared = { mode, search, notify: setNotice, signed };
  return (
    <div className="app-shell">
      {mobile && <div className="sidebar-shade" onClick={() => setMobile(false)} />}
      <aside className={`sidebar ${mobile ? 'is-open' : ''}`}>
        <a className="brand" href="#Overview">
          <span className="brand-mark">
            <Sparkles size={22} />
          </span>
          <span>
            NOVA<span className="brand-ai"> AI</span>
          </span>
          <span className="edition">BETA</span>
        </a>
        <button className="workspace-switch" onClick={() => go('Account Settings')}>
          <span className="workspace-avatar">{(profile.display_name || 'N').slice(0, 1)}</span>
          <span>
            <strong>{profile.display_name || 'Your workspace'}</strong>
            <small>Personal & business</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav>
          {navigation.map(({ label, icon: Icon, section }) => (
            <React.Fragment key={label}>
              {section && <p className="nav-section">{section}</p>}
              <a
                aria-label={label}
                href={`#${label}`}
                onClick={() => setMobile(false)}
                className={`nav-item ${page === label ? 'active' : ''}`}
                aria-current={page === label ? 'page' : undefined}
              >
                <Icon size={18} />
                <span>{label}</span>
                {label === 'Overview' && <span className="nav-key">⌘ 1</span>}
              </a>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Private by design</strong>
              <span>Your context stays yours.</span>
            </div>
          </div>
          <button className="user-card" onClick={() => go('Account Settings')}>
            <span className="user-avatar">{(profile.display_name || 'N').slice(0, 1)}</span>
            <span>
              <strong>{profile.display_name || 'Workspace owner'}</strong>
              <small>{signed ? 'Manage account' : 'Setup required'}</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <div className="searchbox">
              <Search size={16} />
              <input
                aria-label="Search current page"
                placeholder="Search this page…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>/</kbd>
            </div>
            <button
              className="icon-button"
              onClick={() => setHelp(true)}
              aria-label="Help and setup"
            >
              <CircleHelp size={19} />
            </button>
            <span className="top-divider" />
            <span className="connection">
              <i className={signed ? '' : 'muted-dot'} />
              {signed ? 'Workspace connected' : 'Setup mode'}
            </span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR AI, WORKING WITH YOU</div>
              <h1>
                {page === 'Overview'
                  ? `Welcome${profile.display_name ? ', ' + profile.display_name.split(' ')[0] : ' to NOVA'}`
                  : page}
                <span className="heading-dot">.</span>
              </h1>
              <p>{subtitles[page]}</p>
            </div>
            {[
              'Overview',
              'Conversations',
              'Contacts',
              'Memory',
              'Tasks',
              'Reminders',
              'Documents',
              'Usage and Costs',
            ].includes(page) && (
              <div className="mode-control">
                <span>Workspace</span>
                <select
                  aria-label="Workspace mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as Mode)}
                >
                  <option value="all">All activity</option>
                  <option value="personal">Personal</option>
                  <option value="business">Business</option>
                </select>
              </div>
            )}
          </div>
          {!signed && (
            <div className="setup-banner">
              <span className="setup-icon">
                <Zap size={20} />
              </span>
              <div>
                <strong>Your command center is ready to connect.</strong>
                <p>
                  Configure Supabase, sign in, and connect your services to bring NOVA online. No
                  sample data is shown.
                </p>
              </div>
              <button className="button secondary" onClick={() => go('Integrations')}>
                Setup checklist <ArrowRight size={15} />
              </button>
            </div>
          )}
          {page === 'Overview' ? (
            <Overview {...shared} go={go} />
          ) : page === 'Conversations' ? (
            <Conversations {...shared} />
          ) : page === 'Documents' ? (
            <Documents {...shared} />
          ) : page === 'Tool Permissions' ? (
            <Permissions {...shared} />
          ) : page === 'Integrations' ? (
            <Integrations {...shared} />
          ) : page === 'AI Settings' ? (
            <Singleton {...shared} table="ai_settings" />
          ) : page === 'Account Settings' ? (
            <Account {...shared} profile={profile} refresh={() => api('/me').then(setProfile)} />
          ) : page === 'Usage and Costs' ? (
            <Usage {...shared} />
          ) : (
            <ResourcePage key={page} {...shared} page={page} />
          )}
          <footer>
            <span>
              <span className="mini-spark">✦</span> NOVA AI <span className="footer-line">/</span> A
              little more space for what matters.
            </span>
            <span>
              Secure workspace <ShieldCheck size={13} />
            </span>
          </footer>
        </div>
      </main>
      {notice && (
        <div role="status" className="toast">
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice('')}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <Modal title="Your NOVA workspace" close={() => setHelp(false)}>
          <div className="modal-body">
            <p>
              NOVA connects your verified WhatsApp identity to Claude, private memory, tasks, and
              business support.
            </p>
            <ol className="help-list">
              <li>Follow the repository README to configure Supabase and apply migrations.</li>
              <li>Create a dashboard user in Supabase Auth and sign in.</li>
              <li>Add a business profile and register the signed Meta webhook.</li>
              <li>
                Verify your owner phone in Account Settings. Unknown numbers always stay in business
                mode.
              </li>
              <li>Start the persistent worker to process messages and reminders.</li>
            </ol>
            <p className="muted">
              Credentials belong in environment variables, never in dashboard forms. Integrations →
              configured does not mean live-tested.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
type Props = { mode: Mode; search: string; notify: (s: string) => void; signed: boolean };
function Login() {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    setError(error?.message ?? '');
    setBusy(false);
  }
  return (
    <div className="login-screen">
      <div className="login-art">
        <span className="brand-mark large">
          <Sparkles size={38} />
        </span>
        <p className="eyebrow">PERSONAL INTELLIGENCE. THOUGHTFULLY CONNECTED.</p>
        <h1>
          Less busywork.
          <br />
          More possibility<span>.</span>
        </h1>
        <p>
          Your conversations, knowledge, and next steps.
          <br />
          One quietly capable assistant.
        </p>
        <div className="login-orbit">
          <div />
          <span>✦</span>
        </div>
      </div>
      <form onSubmit={submit} className="login-form">
        <span className="eyebrow">NOVA AI · PRIVATE WORKSPACE</span>
        <h2>Welcome back.</h2>
        <p>Sign in to your command center.</p>
        <label>
          Email address
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <>
              Sign in <ArrowRight size={17} />
            </>
          )}
        </button>
        <small>
          Invite-only access. Ask your workspace administrator to create your Supabase Auth account.
        </small>
        <div className="login-security">
          <ShieldCheck size={16} /> Protected by Supabase authentication
        </div>
      </form>
    </div>
  );
}
function useRows(table: string, props: Props, extra = '') {
  const [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function load() {
    if (!props.signed) {
      setRows([]);
      setTotal(0);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api(
        `/data/${table}?page=${page}${props.mode === 'all' ? '' : `&mode=${props.mode}`}${extra}`,
      );
      setRows(r.data);
      setTotal(r.count);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setPage(0);
  }, [table, props.mode, extra]);
  useEffect(() => {
    void load();
  }, [table, props.mode, extra, page, props.signed]);
  return {
    rows: rows.filter(
      (r) => !props.search || JSON.stringify(r).toLowerCase().includes(props.search.toLowerCase()),
    ),
    total,
    page,
    setPage,
    busy,
    error,
    load,
  };
}
function Pagination({ data }: { data: ReturnType<typeof useRows> }) {
  return (
    <div className="table-footer">
      <span>
        {data.total
          ? `${data.page * 50 + 1}–${Math.min((data.page + 1) * 50, data.total)} of ${data.total}`
          : '0 records'}
        <span className="muted"> · Search filters this page</span>
      </span>
      <div>
        <button
          className="icon-button"
          disabled={!data.page}
          onClick={() => data.setPage(data.page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className="icon-button"
          disabled={(data.page + 1) * 50 >= data.total}
          onClick={() => data.setPage(data.page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
function Overview(props: Props & { go: (s: string) => void }) {
  const [data, setData] = useState<Row>({ counts: {}, usage: { daily: [] }, activity: [] }),
    [error, setError] = useState('');
  useEffect(() => {
    if (props.signed)
      api(`/overview${props.mode === 'all' ? '' : `?mode=${props.mode}`}`)
        .then(setData)
        .catch((e) => setError(e.message));
  }, [props.signed, props.mode]);
  const cards = [
    {
      title: 'Conversations',
      key: 'conversations',
      icon: MessageCircle,
      caption: 'Across your workspace',
      to: 'Conversations',
    },
    {
      title: 'People connected',
      key: 'contacts',
      icon: Users,
      caption: 'Personal & business contacts',
      to: 'Contacts',
    },
    {
      title: 'Open tasks',
      key: 'tasks',
      icon: CheckCircle2,
      caption: 'A little progress, every day',
      to: 'Tasks',
    },
    {
      title: 'Upcoming reminders',
      key: 'reminders',
      icon: Bell,
      caption: 'Nothing important forgotten',
      to: 'Reminders',
    },
  ];
  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="section-label">
        <span>
          <i /> WORKSPACE AT A GLANCE
        </span>
        <span>{props.mode === 'all' ? 'All modes' : props.mode} · Live totals</span>
      </div>
      <div className="stats-grid">
        {cards.map((c) => (
          <button className="stat-card" key={c.key} onClick={() => props.go(c.to)}>
            <div>
              <span>{c.title}</span>
              <span className="stat-icon">
                <c.icon size={18} />
              </span>
            </div>
            <strong>
              {props.signed ? (data.counts[c.key] ?? '—') : '—'}
              <ArrowUpRight size={18} />
            </strong>
            <p>{c.caption}</p>
          </button>
        ))}
      </div>
      <div className="overview-middle">
        <section className="panel activity-chart">
          <div className="panel-head">
            <div>
              <h2>Intelligence in motion</h2>
              <p>Your Claude token usage over time</p>
            </div>
            <Badge>Last 30 days</Badge>
          </div>
          <div className="chart-summary">
            <strong>
              {Number(data.usage.input_tokens ?? 0) + Number(data.usage.output_tokens ?? 0) || '—'}
            </strong>
            <span>tokens processed</span>
            <span className="chart-legend">
              <i /> Token usage
            </span>
          </div>
          <TokenChart daily={data.usage.daily ?? []} />
        </section>
        <section className="assistant-card">
          <div className="assistant-top">
            <span className="nova-orb">✦</span>
            <Badge green={props.signed}>{props.signed ? 'Connected' : 'Not connected'}</Badge>
          </div>
          <span className="eyebrow">MEET YOUR SECOND BRAIN</span>
          <h2>
            A little context.
            <br />A lot of possibility.
          </h2>
          <p>
            NOVA brings your conversations, memory, and actions together. On WhatsApp, where your
            day already happens.
          </p>
          <div className="assistant-features">
            <span>
              <Brain size={15} /> Context that stays
            </span>
            <span>
              <ShieldCheck size={15} /> Personal stays private
            </span>
          </div>
          <button onClick={() => props.go('AI Settings')}>
            Make NOVA yours <ArrowUpRight size={17} />
          </button>
        </section>
      </div>
      <div className="overview-bottom">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Recent activity</h2>
              <p>The latest from your workspace</p>
            </div>
            <button className="text-button" onClick={() => props.go('Activity Logs')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          {data.activity.length ? (
            <div className="activity-list">
              {data.activity
                .filter((r: Row) => !props.search || r.action.includes(props.search))
                .map((r: Row) => (
                  <div key={r.id}>
                    <span className="list-icon">
                      <Activity size={16} />
                    </span>
                    <div>
                      <strong>{r.action.replaceAll('.', ' · ')}</strong>
                      <p>{r.details.mode ?? 'Workspace activity'}</p>
                    </div>
                    <time>{formatDate(r.created_at)}</time>
                  </div>
                ))}
            </div>
          ) : (
            <Empty
              icon={Activity}
              title="A fresh start"
              description="Your assistant’s actions and workspace changes will appear here."
            />
          )}
        </section>
        <section className="panel quick-actions">
          <div className="panel-head">
            <div>
              <h2>A good place to start</h2>
              <p>Build a more capable everyday</p>
            </div>
            <Command size={18} />
          </div>
          {[
            {
              icon: Link2,
              title: 'Connect your world',
              desc: 'WhatsApp, Claude & your database',
              to: 'Integrations',
            },
            {
              icon: Brain,
              title: 'Give NOVA some context',
              desc: 'Add an approved fact or preference',
              to: 'Memory',
            },
            {
              icon: FileText,
              title: 'Bring your knowledge',
              desc: 'Upload a document to ask about',
              to: 'Documents',
            },
          ].map((a) => (
            <button key={a.to} onClick={() => props.go(a.to)}>
              <span className="list-icon">
                <a.icon size={18} />
              </span>
              <span>
                <strong>{a.title}</strong>
                <small>{a.desc}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </section>
      </div>
      <div className="privacy-strip">
        <ShieldCheck size={18} />
        <span>
          <strong>Two modes. One clear boundary.</strong> Your personal memory never enters a
          customer conversation.
        </span>
        <button onClick={() => props.go('Tool Permissions')}>
          Review permissions <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}
function TokenChart({ daily }: { daily: Row[] }) {
  const max = Math.max(1, ...daily.map((d) => Number(d.tokens)));
  return (
    <div className="token-chart">
      <div className="chart-scale">
        <span>{max === 1 ? '—' : max.toLocaleString()}</span>
        <span>{max === 1 ? '—' : Math.round(max / 2).toLocaleString()}</span>
        <span>0</span>
      </div>
      <div className="plot">
        <div className="grid-line top" />
        <div className="grid-line middle" />
        <div className="grid-line bottom" />
        {daily.length ? (
          <div className="bars">
            {daily.map((d) => (
              <div key={d.day} className="bar-group" title={`${d.day}: ${d.tokens} tokens`}>
                <div style={{ height: `${Math.max(2, (Number(d.tokens) / max) * 100)}%` }} />
                <small>
                  {new Date(d.day).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <div className="chart-no-data">
            <Activity size={22} />
            <span>Room for your first conversation</span>
            <small>Real usage will appear once Claude is connected.</small>
          </div>
        )}
      </div>
    </div>
  );
}
type Field = { name: string; label: string; type?: string; options?: string[]; required?: boolean };
const modeField: Field = {
  name: 'mode',
  label: 'Workspace mode',
  type: 'select',
  options: ['personal', 'business'],
};
const definitions: Record<
  string,
  { table: string; singular: string; fields: Field[]; columns: string[]; readonly?: boolean }
> = {
  Contacts: {
    table: 'contacts',
    singular: 'contact',
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'phone', label: 'Phone (E.164)', type: 'tel' },
      modeField,
    ],
    columns: ['name', 'phone', 'mode', 'last_inbound_at'],
  },
  Memory: {
    table: 'memories',
    singular: 'memory',
    fields: [
      { name: 'content', label: 'Fact or preference', type: 'textarea' },
      modeField,
      { name: 'approved', label: 'I approve storing this fact', type: 'checkbox' },
    ],
    columns: ['content', 'mode', 'approved', 'created_at'],
  },
  Tasks: {
    table: 'tasks',
    singular: 'task',
    fields: [
      { name: 'title', label: 'Task title' },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: ['open', 'in_progress', 'completed'],
      },
      modeField,
    ],
    columns: ['title', 'status', 'mode', 'created_at'],
  },
  Notes: {
    table: 'notes',
    singular: 'note',
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'content', label: 'Note', type: 'textarea' },
      modeField,
    ],
    columns: ['title', 'content', 'mode', 'created_at'],
  },
  Reminders: {
    table: 'reminders',
    singular: 'reminder',
    fields: [
      { name: 'title', label: 'Reminder' },
      { name: 'contact_id', label: 'Recipient (first 500 contacts in this mode)', type: 'contact' },
      { name: 'due_at', label: 'Due at (your browser’s local time)', type: 'datetime-local' },
      { name: 'timezone', label: 'IANA timezone, e.g. Asia/Karachi' },
      { name: 'recurrence', label: 'Repeat', type: 'select', options: ['none', 'daily', 'weekly'] },
      modeField,
    ],
    columns: ['title', 'due_at', 'recurrence', 'status', 'mode'],
  },
  'Business Profiles': {
    table: 'business_profiles',
    singular: 'business profile',
    fields: [
      { name: 'name', label: 'Business name' },
      { name: 'description', label: 'Business context', type: 'textarea' },
      { name: 'phone_number_id', label: 'Meta phone number ID' },
      { name: 'reminder_template', label: 'Approved reminder template name', required: false },
      { name: 'template_language', label: 'Template language' },
    ],
    columns: ['name', 'description', 'phone_number_id', 'reminder_template'],
  },
  FAQs: {
    table: 'business_faqs',
    singular: 'FAQ',
    fields: [
      { name: 'question', label: 'Question' },
      { name: 'answer', label: 'Answer', type: 'textarea' },
    ],
    columns: ['question', 'answer', 'created_at'],
  },
  'Activity Logs': {
    table: 'audit_logs',
    singular: 'event',
    fields: [],
    columns: ['action', 'details', 'created_at'],
    readonly: true,
  },
  Jobs: {
    table: 'scheduled_jobs',
    singular: 'job',
    fields: [],
    columns: ['kind', 'status', 'attempts', 'run_at', 'last_error'],
    readonly: true,
  },
  'Tool executions': {
    table: 'tool_executions',
    singular: 'execution',
    fields: [],
    columns: ['tool', 'status', 'mode', 'created_at', 'result'],
    readonly: true,
  },
};
function ResourcePage(props: Props & { page: string }) {
  const [tab, setTab] = useState(props.page),
    [edit, setEdit] = useState<Row | null | undefined>(),
    [status, setStatus] = useState('');
  const def = definitions[tab]!;
  const data = useRows(def.table, props, status ? `&status=${status}` : '');
  const tabs =
    props.page === 'Business Profiles'
      ? ['Business Profiles', 'FAQs']
      : props.page === 'Memory'
        ? ['Memory', 'Notes']
        : props.page === 'Activity Logs'
          ? ['Activity Logs', 'Jobs', 'Tool executions']
          : [props.page];
  const change = async (r: Row, values: Row) => {
    try {
      await api(`/data/${def.table}/${r.id}`, { method: 'PATCH', body: JSON.stringify(values) });
      await data.load();
      props.notify('Changes saved');
    } catch (e) {
      props.notify((e as Error).message);
    }
  };
  async function remove(r: Row) {
    if (!confirm(`Permanently delete this ${def.singular}? This cannot be undone.`)) return;
    try {
      await api(`/data/${def.table}/${r.id}`, {
        method: 'DELETE',
        headers: { 'x-confirm-action': 'delete' },
      });
      await data.load();
      props.notify('Deleted');
    } catch (e) {
      props.notify((e as Error).message);
    }
  }
  return (
    <section className="panel resource-panel">
      <div className="panel-head">
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t}
              className={tab === t ? 'selected' : ''}
              onClick={() => {
                setTab(t);
                setStatus('');
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="toolbar">
          {['tasks', 'reminders', 'scheduled_jobs'].includes(def.table) && (
            <select
              aria-label="Status filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {(def.table === 'tasks'
                ? ['open', 'in_progress', 'completed']
                : def.table === 'reminders'
                  ? ['scheduled', 'sent', 'delivered', 'cancelled', 'failed']
                  : ['pending', 'running', 'completed', 'failed']
              ).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          {!def.readonly && (
            <button className="button primary" onClick={() => setEdit(null)}>
              <Plus size={16} />
              Add {def.singular}
            </button>
          )}
        </div>
      </div>
      {data.error && <p className="error inline">{data.error}</p>}
      {data.busy ? (
        <div className="loading">
          <Loader2 className="spin" size={20} /> Loading records…
        </div>
      ) : data.rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {def.columns.map((c) => (
                  <th key={c}>{c.replaceAll('_', ' ')}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  {def.columns.map((c) => (
                    <td key={c}>{renderValue(r[c], c)}</td>
                  ))}
                  <td>
                    <div className="row-actions">
                      {!def.readonly && (
                        <>
                          <button className="text-button" onClick={() => setEdit(r)}>
                            Edit
                          </button>
                          {def.table === 'tasks' && r.status !== 'completed' && (
                            <button
                              className="icon-button"
                              onClick={() => change(r, { status: 'completed' })}
                              title="Complete task"
                            >
                              <Check size={17} />
                            </button>
                          )}
                          {def.table === 'reminders' && r.status === 'scheduled' && (
                            <button
                              className="text-button"
                              onClick={() => {
                                if (confirm('Cancel this reminder?'))
                                  void change(r, { status: 'cancelled' });
                              }}
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            className="icon-button danger"
                            onClick={() => remove(r)}
                            aria-label={`Delete ${def.singular}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                      {def.table === 'scheduled_jobs' && r.status === 'failed' && (
                        <button
                          className="text-button"
                          onClick={async () => {
                            if (
                              !confirm(
                                'Retry this job? A previously delivered WhatsApp message may be duplicated.',
                              )
                            )
                              return;
                            try {
                              await api(`/jobs/${r.id}/retry`, { method: 'POST' });
                              await data.load();
                            } catch (e) {
                              props.notify((e as Error).message);
                            }
                          }}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={
            props.page === 'Memory'
              ? Brain
              : props.page === 'Tasks'
                ? CheckCircle2
                : props.page === 'Reminders'
                  ? Bell
                  : props.page === 'Activity Logs'
                    ? Activity
                    : BookOpen
          }
          title={`No ${tab.toLowerCase()} yet`}
          description={
            def.readonly
              ? 'Real events appear here as NOVA works.'
              : 'Add your first record to give NOVA something useful to work with.'
          }
          action={
            !def.readonly && (
              <button className="button secondary" onClick={() => setEdit(null)}>
                <Plus size={15} />
                Add {def.singular}
              </button>
            )
          }
        />
      )}
      <Pagination data={data} />
      {props.page === 'Reminders' && (
        <p className="panel-note">
          <Clock3 size={14} /> Outside the 24-hour WhatsApp window, an approved template is
          required. Delivery needs the worker.
        </p>
      )}
      {edit !== undefined && (
        <EditForm
          title={`${edit ? 'Edit' : 'New'} ${def.singular}`}
          fields={def.fields}
          initial={
            edit ?? {
              mode: props.mode === 'all' ? 'personal' : props.mode,
              timezone: 'Asia/Karachi',
              approved: false,
              template_language: 'en_US',
            }
          }
          close={() => setEdit(undefined)}
          save={async (values) => {
            if (def.table === 'reminders') values.due_at = new Date(values.due_at).toISOString();
            await api(`/data/${def.table}${edit ? `/${edit.id}` : ''}`, {
              method: edit ? 'PATCH' : 'POST',
              body: JSON.stringify(values),
            });
            await data.load();
            props.notify('Saved successfully');
          }}
        />
      )}
    </section>
  );
}
function renderValue(value: any, key: string) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (typeof value === 'boolean')
    return <Badge green={value}>{value ? 'Approved' : 'Not approved'}</Badge>;
  if (key.endsWith('_at')) return <span className="date-cell">{formatDate(value)}</span>;
  if (['mode', 'status'].includes(key))
    return (
      <Badge green={['personal', 'completed', 'delivered', 'scheduled'].includes(value)}>
        {value.replaceAll('_', ' ')}
      </Badge>
    );
  if (typeof value === 'object')
    return (
      <span className="cell-truncate" title={JSON.stringify(value)}>
        {JSON.stringify(value)}
      </span>
    );
  return (
    <span className="cell-truncate" title={String(value)}>
      {String(value)}
    </span>
  );
}
function EditForm({
  title,
  fields,
  initial,
  save,
  close,
}: {
  title: string;
  fields: Field[];
  initial: Row;
  save: (v: Row) => Promise<void>;
  close: () => void;
}) {
  const [values, setValues] = useState<Row>(() =>
      Object.fromEntries(
        fields.map((f) => {
          let value = initial[f.name] ?? (f.type === 'checkbox' ? false : (f.options?.[0] ?? ''));
          if (f.type === 'datetime-local' && value) {
            const date = new Date(value);
            if (!Number.isNaN(date.valueOf()))
              value = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16);
          }
          return [f.name, value];
        }),
      ),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<Row[]>([]);
  useEffect(() => {
    if (!fields.some((field) => field.type === 'contact')) return;
    let active = true;
    api(`/contacts/options?mode=${values.mode ?? 'personal'}`)
      .then((rows) => {
        if (active) setContacts(rows);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [values.mode]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = { ...values };
      for (const f of fields) if (f.required === false && data[f.name] === '') data[f.name] = null;
      await save(data);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} close={close}>
      <form onSubmit={submit} className="form modal-body">
        {fields.map((f) => (
          <label key={f.name} className={f.type === 'checkbox' ? 'checkbox-field' : ''}>
            {f.type !== 'checkbox' && f.label}
            {f.type === 'textarea' ? (
              <textarea
                rows={4}
                required={f.required !== false}
                maxLength={10000}
                value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            ) : f.type === 'contact' ? (
              <select
                required
                value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              >
                <option value="">Choose a recipient</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} · {contact.phone}
                  </option>
                ))}
              </select>
            ) : f.type === 'select' ? (
              <select
                value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              >
                {f.options!.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type ?? 'text'}
                required={f.required !== false}
                checked={f.type === 'checkbox' ? values[f.name] : undefined}
                value={f.type === 'checkbox' ? undefined : values[f.name]}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [f.name]: f.type === 'checkbox' ? e.target.checked : e.target.value,
                  })
                }
              />
            )}
            {f.type === 'checkbox' && f.label}
          </label>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Conversations(props: Props) {
  const data = useRows('conversations', props),
    [selected, setSelected] = useState<Row | null>(null),
    [messages, setMessages] = useState<Row[]>([]),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [stream, setStream] = useState('');
  async function loadMessages(id: string) {
    try {
      setMessages((await api(`/data/messages?conversation_id=${id}`)).data.reverse());
    } catch (e) {
      props.notify((e as Error).message);
    }
  }
  useEffect(() => {
    if (selected) {
      void loadMessages(selected.id);
      const id = setInterval(() => void loadMessages(selected.id), 10000);
      return () => clearInterval(id);
    }
  }, [selected]);
  useEffect(() => {
    setSelected(null);
    setMessages([]);
  }, [props.mode]);
  async function send(ai = false) {
    if (!text.trim() || !selected) return;
    setBusy(true);
    try {
      if (ai) {
        await streamReply(selected.id, text, setStream);
        await loadMessages(selected.id);
        setStream('');
      } else {
        await api(`/conversations/${selected.id}/reply`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        props.notify('Reply queued for WhatsApp delivery');
      }
      setText('');
    } catch (e) {
      props.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel conversation-layout">
      <div className="conversation-sidebar">
        <div className="panel-head">
          <h2>Inbox</h2>
          <Badge>{data.total}</Badge>
        </div>
        {data.error && <p className="error inline">{data.error}</p>}
        {data.rows.length ? (
          data.rows.map((c) => (
            <button
              key={c.id}
              className={`conversation-item ${selected?.id === c.id ? 'selected' : ''}`}
              onClick={() => {
                setSelected(c);
                setStream('');
              }}
            >
              <span className="contact-avatar">{c.title.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{c.title}</strong>
                <small>
                  {c.mode} · {formatDate(c.created_at)}
                </small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))
        ) : (
          <Empty
            title="Your inbox is quiet"
            description="Incoming WhatsApp conversations appear here automatically."
          />
        )}
        <Pagination data={data} />
      </div>
      <div className="conversation-detail">
        {selected ? (
          <>
            <div className="panel-head">
              <div>
                <h2>{selected.title}</h2>
                <p>Latest 50 messages · refreshed every 10 seconds</p>
              </div>
              <Badge green={selected.mode === 'personal'}>{selected.mode}</Badge>
            </div>
            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className={`message ${m.role}`}>
                  <span>{m.role === 'assistant' ? 'NOVA / Workspace' : 'Contact'}</span>
                  <p dir="auto">{m.content}</p>
                  <small>
                    {formatDate(m.created_at)} · {m.status}
                  </small>
                </div>
              ))}
              {stream && (
                <div className="message assistant">
                  <span>NOVA · generating</span>
                  <p dir="auto">{stream}</p>
                </div>
              )}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                rows={2}
                aria-label="Reply message"
                placeholder="Write a reply…"
                maxLength={4000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div>
                <span>WhatsApp’s 24-hour window applies.</span>
                {selected.mode === 'personal' && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || !text.trim()}
                    onClick={() => void send(true)}
                  >
                    <Sparkles size={15} />
                    Ask NOVA (web)
                  </button>
                )}
                <button className="button primary" disabled={busy || !text.trim()}>
                  {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}Send reply
                </button>
              </div>
            </form>
          </>
        ) : (
          <Empty
            icon={MessageCircle}
            title="A conversation starts here"
            description="Select a conversation to see its context and send a reply."
          />
        )}
      </div>
    </section>
  );
}
function Documents(props: Props) {
  const data = useRows('media_files', props),
    [uploading, setUploading] = useState(false),
    [ask, setAsk] = useState<Row | null>(null),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState(''),
    [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mode', props.mode === 'all' ? 'personal' : props.mode);
      await api('/documents', { method: 'POST', body: form });
      await data.load();
      props.notify('File stored privately');
    } catch (e) {
      props.notify((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function action(r: Row, kind: string) {
    try {
      if (kind === 'download') {
        const result = await api(`/documents/${r.id}/download`);
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else if (kind === 'delete') {
        if (!confirm('Permanently delete this file?')) return;
        await api(`/documents/${r.id}`, {
          method: 'DELETE',
          headers: { 'x-confirm-action': 'delete' },
        });
        await data.load();
      } else {
        if (
          !confirm(
            r.approved
              ? 'Revoke sharing approval?'
              : 'Approve this file for sending by NOVA in its assigned mode? Each send still needs confirmation.',
          )
        )
          return;
        await api(`/documents/${r.id}/approval`, {
          method: 'PATCH',
          body: JSON.stringify({ approved: !r.approved }),
        });
        await data.load();
      }
    } catch (e) {
      props.notify((e as Error).message);
    }
  }
  return (
    <>
      <div className="upload-area">
        <span className="empty-icon">
          <FileText size={24} />
        </span>
        <div>
          <h3>Make your knowledge useful.</h3>
          <p>PDF, DOCX, XLSX, images & audio · Up to 10 MB · Stored privately</p>
        </div>
        <label className={`button primary ${uploading ? 'disabled' : ''}`}>
          {uploading ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}Upload file
          <input
            type="file"
            hidden
            disabled={uploading}
            accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,.ogg,.mp3,.m4a,.wav,.webm"
            onChange={(e) => {
              if (e.target.files?.[0]) void upload(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Your library</h2>
            <p>
              {props.mode === 'all'
                ? 'All modes · New uploads default to personal'
                : `${props.mode} workspace`}
            </p>
          </div>
          <Badge>{data.total} files</Badge>
        </div>
        {data.error && <p className="error inline">{data.error}</p>}
        {data.rows.length ? (
          <div className="documents-grid">
            {data.rows.map((r) => (
              <article className="document-card" key={r.id}>
                <span className="file-icon">
                  <FileText size={24} />
                </span>
                <Badge green={r.approved}>{r.approved ? 'Sharing approved' : 'Private'}</Badge>
                <h3>{r.name}</h3>
                <p>
                  {r.mode} · {(r.size_bytes / 1024).toFixed(1)} KB
                </p>
                <small>{formatDate(r.created_at)}</small>
                <div className="document-actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      setAsk(r);
                      setQuestion('Summarize this document.');
                      setAnswer('');
                    }}
                  >
                    Ask NOVA <Sparkles size={13} />
                  </button>
                  <button
                    className="icon-button"
                    title="Download"
                    onClick={() => action(r, 'download')}
                  >
                    <Download size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title={r.approved ? 'Revoke approval' : 'Approve sharing'}
                    onClick={() => action(r, 'approve')}
                  >
                    <ShieldCheck size={16} />
                  </button>
                  <button
                    className="icon-button danger"
                    title="Delete file"
                    onClick={() => action(r, 'delete')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={FileText}
            title="A home for your knowledge"
            description="Upload a file to summarize it or ask a question. Nothing is shared until you approve it."
          />
        )}
        <Pagination data={data} />
      </section>
      {ask && (
        <Modal title={`Ask about ${ask.name}`} close={() => setAsk(null)}>
          <form
            className="modal-body form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                setAnswer(
                  (
                    await api(`/documents/${ask.id}/ask`, {
                      method: 'POST',
                      body: JSON.stringify({ question }),
                    })
                  ).answer,
                );
              } catch (e) {
                props.notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Your question
              <textarea
                required
                value={question}
                maxLength={4000}
                rows={3}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}Ask NOVA
            </button>
            {answer && (
              <div className="answer" dir="auto">
                {answer}
              </div>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
function Permissions(props: Props) {
  const data = useRows('permissions', props);
  async function toggle(tool: string, field: string, value: boolean) {
    try {
      const row = data.rows.find((r) => r.tool === tool);
      await api(`/data/permissions${row ? `/${row.id}` : ''}`, {
        method: row ? 'PATCH' : 'POST',
        body: JSON.stringify(
          row
            ? { [field]: value }
            : { tool, enabled: true, business_enabled: false, [field]: value },
        ),
      });
      await data.load();
    } catch (e) {
      props.notify((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Small tools. Clear boundaries.</h2>
          <p>
            Defaults are shown until you save an override. Business personal-data tools are always
            blocked.
          </p>
        </div>
        <ShieldCheck size={21} />
      </div>
      {data.error && <p className="error inline">{data.error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Capability</th>
              <th>Enabled</th>
              <th>Business access</th>
              <th>Safeguard</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(toolSchemas)
              .filter((t) => t.includes(props.search.replaceAll(' ', '_')))
              .map((tool) => {
                const row = data.rows.find((r) => r.tool === tool);
                const restricted = personalOnly.has(tool as any);
                const business =
                  row?.business_enabled ??
                  ['search_faqs', 'business_info', 'generate_summary'].includes(tool);
                return (
                  <tr key={tool}>
                    <td>
                      <strong>{tool.replaceAll('_', ' ')}</strong>
                      <small className="block muted">
                        {row ? 'Saved policy' : 'Default policy'}
                      </small>
                    </td>
                    <td>
                      <Toggle
                        checked={row?.enabled ?? true}
                        onChange={(v) => toggle(tool, 'enabled', v)}
                        label={`Enable ${tool}`}
                      />
                    </td>
                    <td>
                      <Toggle
                        checked={!restricted && business}
                        disabled={restricted}
                        onChange={(v) => toggle(tool, 'business_enabled', v)}
                        label={`Business access for ${tool}`}
                      />
                    </td>
                    <td>
                      <Badge green>
                        {restricted
                          ? 'Owner only'
                          : [
                                'delete_task',
                                'cancel_reminder',
                                'send_approved_file',
                                'save_memory',
                              ].includes(tool)
                            ? 'Confirmation required'
                            : 'Scoped access'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Singleton(props: Props & { table: 'ai_settings' }) {
  const data = useRows(props.table, props),
    [edit, setEdit] = useState(false);
  const row = data.rows[0];
  return (
    <section className="panel settings-panel">
      <div className="panel-head">
        <div>
          <h2>NOVA’s personality</h2>
          <p>System boundaries and privacy rules cannot be overridden by personality settings.</p>
        </div>
        <Sparkles size={20} />
      </div>
      {data.error && <p className="error inline">{data.error}</p>}
      {row ? (
        <div className="settings-content">
          <div className="setting-value">
            <span>Personality & tone</span>
            <p>{row.personality}</p>
          </div>
          <div className="setting-value">
            <span>Response language</span>
            <Badge green>{row.response_language}</Badge>
          </div>
          <div className="setting-value">
            <span>Voice replies</span>
            <Badge>{row.voice_replies ? 'Enabled when TTS is configured' : 'Text only'}</Badge>
          </div>
          <button className="button primary" onClick={() => setEdit(true)}>
            <Settings2 size={16} />
            Customize NOVA
          </button>
        </div>
      ) : (
        <Empty
          icon={Sparkles}
          title="A personality of your own"
          description="Sign in after database setup to customize NOVA’s tone, language, and voice preferences."
        />
      )}
      {edit && row && (
        <EditForm
          title="Customize NOVA"
          fields={[
            { name: 'personality', label: 'Personality', type: 'textarea' },
            {
              name: 'response_language',
              label: 'Response language',
              type: 'select',
              options: ['auto', 'English', 'Urdu', 'Roman Urdu'],
            },
            {
              name: 'voice_replies',
              label: 'Supplement text replies with voice (requires configured provider)',
              type: 'checkbox',
              required: false,
            },
          ]}
          initial={row}
          close={() => setEdit(false)}
          save={async (v) => {
            await api(`/data/ai_settings/${row.id}`, { method: 'PATCH', body: JSON.stringify(v) });
            await data.load();
          }}
        />
      )}
    </section>
  );
}
function Integrations(props: Props) {
  const [status, setStatus] = useState<Row>({}),
    [error, setError] = useState('');
  useEffect(() => {
    if (props.signed)
      api('/integrations')
        .then(setStatus)
        .catch((e) => setError(e.message));
  }, [props.signed]);
  const services = [
    {
      key: 'database',
      name: 'Supabase',
      tag: 'DATABASE & IDENTITY',
      icon: Link2,
      description: 'Your private PostgreSQL database, authentication, and secure file storage.',
      steps: [
        'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.',
        'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild the web app.',
        'Apply supabase/migrations/001_nova.sql. Create an Auth user.',
      ],
    },
    {
      key: 'claude',
      name: 'Claude by Anthropic',
      tag: 'REASONING ENGINE',
      icon: Sparkles,
      description: 'Thoughtful conversations, vision, document understanding, and safe tool use.',
      steps: [
        'Set ANTHROPIC_API_KEY in the API and worker environments.',
        `Model: ${status.model ?? 'claude-sonnet-4-5'}. Verify your account has model access.`,
      ],
    },
    {
      key: 'whatsapp',
      name: 'WhatsApp Cloud API',
      tag: 'YOUR EVERYDAY INTERFACE',
      icon: MessageCircle,
      description: 'Official Meta integration. No QR sessions. No unofficial bridges.',
      steps: [
        'Set WHATSAPP_ACCESS_TOKEN, META_APP_SECRET, and WHATSAPP_VERIFY_TOKEN.',
        'Add your Meta phone number ID in Business Profiles.',
        'Register HTTPS /api/webhooks/whatsapp; subscribe to messages.',
        'Start the worker. Verify your owner number in Account Settings.',
      ],
    },
    {
      key: 'transcription',
      name: 'Voice & transcription',
      tag: 'OPTIONAL CAPABILITY',
      icon: AudioLines,
      description: 'Turn voice notes into context. Add spoken replies with a suitable provider.',
      steps: [
        'Set HTTPS STT_URL, STT_API_KEY, and STT_MODEL for OpenAI-compatible transcription.',
        'Optional: TTS_URL, TTS_API_KEY, TTS_MODEL, and TTS_VOICE.',
        'Language support depends on the provider. Test Urdu and English audio directly.',
      ],
    },
  ];
  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="integration-grid">
        {services
          .filter((s) =>
            `${s.name} ${s.description}`.toLowerCase().includes(props.search.toLowerCase()),
          )
          .map((s) => (
            <section className="panel integration-card" key={s.key}>
              <div className="integration-title">
                <span className="integration-icon">
                  <s.icon size={25} />
                </span>
                <Badge green={!!status[s.key]}>
                  {status[s.key] ? 'Configured' : 'Setup needed'}
                </Badge>
              </div>
              <span className="eyebrow">{s.tag}</span>
              <h2>{s.name}</h2>
              <p>{s.description}</p>
              <details>
                <summary>
                  Configuration guide <ChevronDown size={15} />
                </summary>
                <ol>
                  {s.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </details>
            </section>
          ))}
      </div>
      <div className="privacy-strip">
        <ShieldCheck size={18} />
        <span>
          <strong>Secrets stay on the server.</strong> Configured status indicates environment
          presence, not a successful live integration test.
        </span>
      </div>
    </>
  );
}
function Account(props: Props & { profile: Row; refresh: () => Promise<unknown> }) {
  const [edit, setEdit] = useState(false),
    [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [requested, setRequested] = useState(false),
    [busy, setBusy] = useState(false);
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/account/phone/${requested ? 'verify' : 'request'}`, {
        method: 'POST',
        body: JSON.stringify(requested ? { code } : { phone }),
      });
      if (requested) {
        await props.refresh();
        setRequested(false);
        setCode('');
        props.notify('Owner number verified');
      } else {
        setRequested(true);
        props.notify('Verification code sent to WhatsApp');
      }
    } catch (e) {
      props.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>Your account</h2>
          <Users size={19} />
        </div>
        <div className="settings-content">
          <div className="account-avatar">{(props.profile.display_name ?? 'N').slice(0, 1)}</div>
          <div className="setting-value">
            <span>Display name</span>
            <strong>{props.profile.display_name ?? 'Not signed in'}</strong>
          </div>
          <div className="setting-value">
            <span>Timezone</span>
            <strong>{props.profile.timezone ?? 'Not configured'}</strong>
          </div>
          <div className="setting-value">
            <span>Role</span>
            <Badge green>{props.profile.role ?? 'Setup mode'}</Badge>
          </div>
          <button className="button secondary" onClick={() => setEdit(true)}>
            Edit profile
          </button>
          {props.signed && (
            <button className="button secondary" onClick={() => supabase!.auth.signOut()}>
              <LogOut size={16} />
              Sign out
            </button>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Your private WhatsApp identity</h2>
            <p>Only a verified number can access personal mode.</p>
          </div>
          <ShieldCheck size={21} />
        </div>
        <form className="settings-content form" onSubmit={verify}>
          <Badge green={!!props.profile.owner_phone}>
            {props.profile.owner_phone ?? 'No verified owner number'}
          </Badge>
          <p className="muted">
            First message your connected business number on WhatsApp. Then request a code below. New
            and unknown numbers always enter business mode.
          </p>
          <label>
            {requested ? '6-digit verification code' : 'Your phone number (E.164)'}
            <input
              required
              type={requested ? 'text' : 'tel'}
              pattern={requested ? '[0-9]{6}' : '\\+[1-9][0-9]{6,14}'}
              placeholder={requested ? '123456' : '+923001234567'}
              value={requested ? code : phone}
              onChange={(e) => (requested ? setCode(e.target.value) : setPhone(e.target.value))}
            />
          </label>
          <div className="form-actions">
            {requested && (
              <button
                className="button secondary"
                type="button"
                onClick={() => setRequested(false)}
              >
                Start over
              </button>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
              {requested ? 'Verify number' : 'Send verification code'}
            </button>
          </div>
        </form>
      </section>
      {edit && (
        <EditForm
          title="Edit your profile"
          fields={[
            { name: 'display_name', label: 'Display name' },
            { name: 'timezone', label: 'IANA timezone' },
          ]}
          initial={props.profile}
          close={() => setEdit(false)}
          save={async (v) => {
            await api(`/data/profiles/${props.profile.id}`, {
              method: 'PATCH',
              body: JSON.stringify(v),
            });
            await props.refresh();
          }}
        />
      )}
    </div>
  );
}
function Usage(props: Props) {
  const [data, setData] = useState<Row>({ usage: { daily: [] } }),
    [rates, setRates] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem('nova-rates') ?? '{"input":0,"output":0}');
      } catch {
        return { input: 0, output: 0 };
      }
    });
  useEffect(() => {
    if (props.signed)
      api(`/overview${props.mode === 'all' ? '' : `?mode=${props.mode}`}`)
        .then(setData)
        .catch((e) => props.notify(e.message));
  }, [props.signed, props.mode]);
  const usage = data.usage;
  function rate(key: string, value: string) {
    const next = { ...rates, [key]: Math.max(0, Number(value)) };
    setRates(next);
    localStorage.setItem('nova-rates', JSON.stringify(next));
  }
  return (
    <>
      <div className="stats-grid usage-stats">
        {[
          { title: 'Input tokens', value: usage.input_tokens },
          { title: 'Output tokens', value: usage.output_tokens },
          { title: 'Claude requests', value: usage.requests },
          {
            title: 'Estimated model cost',
            value:
              rates.input || rates.output
                ? `$${((Number(usage.input_tokens ?? 0) * rates.input + Number(usage.output_tokens ?? 0) * rates.output) / 1e6).toFixed(4)}`
                : 'Set rates below',
          },
        ].map((c) => (
          <div className="stat-card" key={c.title}>
            <div>{c.title}</div>
            <strong>{c.value ?? '—'}</strong>
            <p>Last 30 days · {props.mode === 'all' ? 'All modes' : props.mode}</p>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Token activity</h2>
          <Badge>Last 30 days</Badge>
        </div>
        <TokenChart daily={usage.daily ?? []} />
      </section>
      <section className="panel cost-settings">
        <div className="panel-head">
          <div>
            <h2>Your cost assumptions</h2>
            <p>
              Enter your actual model rates. Estimates exclude caching, media, Meta fees, taxes, and
              infrastructure. Not an invoice.
            </p>
          </div>
        </div>
        <div className="rate-inputs">
          <label>
            Input · USD / million tokens
            <input
              type="number"
              min="0"
              step="0.01"
              value={rates.input}
              onChange={(e) => rate('input', e.target.value)}
            />
          </label>
          <label>
            Output · USD / million tokens
            <input
              type="number"
              min="0"
              step="0.01"
              value={rates.output}
              onChange={(e) => rate('output', e.target.value)}
            />
          </label>
          <p>Assumptions are saved in this browser only.</p>
        </div>
      </section>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
