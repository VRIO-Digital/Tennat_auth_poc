import { useEffect, useState, type FormEvent } from 'react'
import { api, BASE_DOMAIN, type Workspace } from './lib/api'
import Icon, { type IconName } from './Icon'
import ProviderLogo from './ProviderLogo'

const ROLES = [
  { key: 'platform_admin', label: 'Platform Admin', desc: 'Full access to workspace settings and users' },
  { key: 'domain_architect', label: 'Domain Architect', desc: 'Designs graphs and data models' },
  { key: 'data_steward', label: 'Data Steward', desc: 'Curates and maintains data quality' },
  { key: 'compliance_auditor', label: 'Compliance Auditor', desc: 'Read-only access for audits and reviews' },
  { key: 'business_user', label: 'Business User', desc: 'Explores graphs and asks questions' },
]

const roleLabel = (key: string) =>
  ROLES.find((r) => r.key === key)?.label ?? key.charAt(0).toUpperCase() + key.slice(1)

function RoleSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const current = ROLES.find((r) => r.key === value)

  return (
    <div className="rselect" onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" disabled={disabled} className={`rselect-btn ${value ? '' : 'placeholder'}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        {current?.label ?? (value ? roleLabel(value) : 'Select your role')}
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <ul className="rselect-list" role="listbox">
          {ROLES.map((r) => (
            <li
              key={r.key}
              role="option"
              aria-selected={r.key === value}
              className={r.key === value ? 'selected' : ''}
              onClick={() => {
                onChange(r.key)
                setOpen(false)
              }}
            >
              <span>
                <b>{r.label}</b>
                <small>{r.desc}</small>
              </span>
              {r.key === value && <Icon name="check" size={16} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Members = {
  members: { user_id: number; name: string; email: string; role: string; active: boolean }[]
  invites: { id: number; email: string; role: string }[]
}
type Domain = { domain: string | null; cname_host: string | null; cname_target: string }

function useAction() {
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(fn: () => Promise<string | void>) {
    setError('')
    setOk('')
    setBusy(true)
    try {
      setOk((await fn()) || '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { error, ok, busy, run }
}

function Notice({ error, ok }: { error: string; ok: string }) {
  return (
    <>
      {error && <div className="msg error">{error}</div>}
      {ok && <div className="msg ok">{ok}</div>}
    </>
  )
}

function UsersCard({ ws, token }: { ws: Workspace; token: string }) {
  const [data, setData] = useState<Members | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'pending'>('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<{ user_id: number; name: string; email: string; role: string; active: boolean } | null>(null)
  const { error, ok, busy, run } = useAction()
  const base = `/api/workspaces/${ws.workspace_id}`

  const load = () => api<Members>(`${base}/users`, { token }).then(setData)
  useEffect(() => {
    load().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open && !editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setEditing(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editing])

  const saveEdit = (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    run(async () => {
      await api(`${base}/users/${editing.user_id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ name: editing.name, role: editing.role, active: editing.active }),
      })
      await load()
      setEditing(null)
    })
  }

  const removeUser = () => {
    if (!editing || !window.confirm(`Remove ${editing.name} from this workspace?`)) return
    run(async () => {
      await api(`${base}/users/${editing.user_id}`, { method: 'DELETE', token })
      await load()
      setEditing(null)
    })
  }

  const invite = (e: FormEvent) => {
    e.preventDefault()
    if (!role) {
      run(async () => {
        throw new Error('Please select a role')
      })
      return
    }
    run(async () => {
      await api(`${base}/invites`, { method: 'POST', token, body: JSON.stringify({ email, role }) })
      setEmail('')
      setRole('')
      await load()
      setOpen(false)
    })
  }

  const setActive = (userId: number, active: boolean) =>
    run(async () => {
      await api(`${base}/users/${userId}`, { method: 'PATCH', token, body: JSON.stringify({ active }) })
      await load()
    })

  const revoke = (id: number) =>
    run(async () => {
      await api(`${base}/invites/${id}`, { method: 'DELETE', token })
      await load()
    })

  type Status = 'active' | 'inactive' | 'pending'
  type Row = { key: string; name: string; email: string; role: string; status: Status; userId?: number; inviteId?: number }
  const all: Row[] = [
    ...(data?.members ?? []).map((m) => ({
      key: `m-${m.user_id}`,
      name: m.name,
      email: m.email,
      role: m.role,
      status: (m.active ? 'active' : 'inactive') as Status,
      userId: m.user_id,
    })),
    ...(data?.invites ?? []).map((i) => ({ key: `i-${i.id}`, name: '—', email: i.email, role: i.role, status: 'pending' as Status, inviteId: i.id })),
  ]
  const count = (st: Status) => all.filter((r) => r.status === st).length
  const rows = all
    .filter((r) => filter === 'all' || r.status === filter)
    .filter((r) => `${r.name} ${r.email}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <section className="panel table-panel">
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search" placeholder="Search users…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="seg" role="tablist">
            {(
              [
                ['all', 'All', all.length],
                ['active', 'Active', count('active')],
                ['inactive', 'Inactive', count('inactive')],
                ['pending', 'Pending', count('pending')],
              ] as const
            ).map(([key, label, n]) => (
              <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
                {label} <span>{n}</span>
              </button>
            ))}
          </div>
        </div>
        <button className="primary" onClick={() => setOpen(true)}>
          <Icon name="plus" size={16} /> Invite user
        </button>
      </div>
      {!open && !editing && <Notice error={error} ok={ok} />}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <div className="cell-user">
                    <div className={`avatar ${r.status !== 'active' ? 'ghost' : ''}`}>{(r.status === 'pending' ? r.email : r.name).charAt(0).toUpperCase()}</div>
                    <strong>{r.name}</strong>
                  </div>
                </td>
                <td className="muted-cell">{r.email}</td>
                <td>
                  <span className="badge">{roleLabel(r.role)}</span>
                </td>
                <td>
                  <span className={`status ${r.status}`}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span>
                </td>
                <td className="right">
                  {r.status === 'pending' ? (
                    <button className="link danger" onClick={() => revoke(r.inviteId!)}>
                      Revoke
                    </button>
                  ) : (
                    <div className="row-actions">
                      {r.role !== 'owner' && (
                        <button className={`link ${r.status === 'active' ? 'danger' : ''}`} disabled={busy} onClick={() => setActive(r.userId!, r.status !== 'active')}>
                          {r.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                      <button className="edit-btn" onClick={() => setEditing({ user_id: r.userId!, name: r.name, email: r.email, role: r.role, active: r.status === 'active' })}>
                        <Icon name="edit" size={15} /> Edit
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {data && !rows.length && (
              <tr>
                <td colSpan={5} className="empty-cell">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-foot">
        Showing {rows.length} of {all.length} {all.length === 1 ? 'user' : 'users'}
      </div>

      {editing && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal small" role="dialog" aria-modal="true" aria-label="Edit user">
            <div className="dlg-head">
              <div className="dlg-icon">
                <Icon name="edit" size={22} />
              </div>
              <div className="dlg-title">
                <h3>Edit user</h3>
                <p>Update details, role and access for this user.</p>
              </div>
              <button type="button" className="dlg-close" onClick={() => setEditing(null)} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <form onSubmit={saveEdit}>
              <div className="dlg-body">
                <label className="field">
                  <span>Name</span>
                  <div className="input">
                    <input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </div>
                </label>
                <label className="field">
                  <span>Email address</span>
                  <div className="input readonly">
                    <input value={editing.email} readOnly />
                  </div>
                </label>
                <div className="field">
                  <span>Role</span>
                  <RoleSelect value={editing.role} disabled={editing.role === 'owner'} onChange={(v) => setEditing({ ...editing, role: v })} />
                </div>
                <div className="switch-row">
                  <div>
                    <strong>Active</strong>
                    <small>{editing.role === 'owner' ? 'The owner always has access' : editing.active ? 'This user can access the workspace' : 'Access is turned off'}</small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editing.active}
                    aria-label="Active"
                    disabled={editing.role === 'owner'}
                    className={`switch ${editing.active ? 'on' : ''}`}
                    onClick={() => setEditing({ ...editing, active: !editing.active })}
                  />
                </div>
                <Notice error={error} ok="" />
              </div>
              <div className="dlg-foot split">
                {editing.role !== 'owner' ? (
                  <button type="button" className="link danger" onClick={removeUser}>
                    Remove user
                  </button>
                ) : (
                  <span />
                )}
                <div className="dlg-foot-right">
                  <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button className="primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {open && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal small" role="dialog" aria-modal="true" aria-label="Invite user">
            <div className="dlg-head">
              <div className="dlg-icon">
                <Icon name="userPlus" size={22} />
              </div>
              <div className="dlg-title">
                <h3>Invite user</h3>
                <p>They get access when they sign in with this email.</p>
              </div>
              <button type="button" className="dlg-close" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <form onSubmit={invite}>
              <div className="dlg-body">
                <label className="field">
                  <span>Email address</span>
                  <div className="input">
                    <input type="email" required autoFocus placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </label>
                <div className="field">
                  <span>Role</span>
                  <RoleSelect value={role} onChange={setRole} />
                </div>
                <Notice error={error} ok="" />
              </div>
              <div className="dlg-foot">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? 'Inviting…' : 'Send invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

function AddressCard({ ws, token }: { ws: Workspace; token: string }) {
  const [slug, setSlug] = useState(ws.slug)
  const [status, setStatus] = useState<{ available: boolean; reason: string | null } | null>(null)
  const { error, busy, run } = useAction()
  const suffix = `.${BASE_DOMAIN}`
  const changed = slug !== ws.slug

  useEffect(() => {
    setStatus(null)
    if (!changed) return
    const t = setTimeout(() => {
      api<{ available: boolean; reason: string | null }>(`/api/workspaces/check-slug?slug=${encodeURIComponent(slug)}&workspace_id=${ws.workspace_id}`)
        .then(setStatus)
        .catch(() => undefined)
    }, 350)
    return () => clearTimeout(t)
  }, [slug, changed, ws.workspace_id])

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!window.confirm(`Change your workspace address to ${slug}${suffix}? The old address will stop working and you'll be redirected.`)) return
    run(async () => {
      const r = await api<{ url: string }>(`/api/workspaces/${ws.workspace_id}/slug`, { method: 'PUT', token, body: JSON.stringify({ slug }) })
      location.href = `${r.url}/#token=${encodeURIComponent(token)}`
    })
  }

  return (
    <section className="panel">
      <h3>Workspace address</h3>
      <p className="muted">The web address your team uses to open this workspace.</p>
      <form onSubmit={save}>
        <div className="input addr">
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} required minLength={3} maxLength={40} aria-label="Workspace address" />
          <em>{suffix}</em>
        </div>
        {changed && status && (
          <p className={`hint-line ${status.available ? 'good' : 'bad'}`}>{status.available ? '✓ Available' : `✗ ${status.reason}`}</p>
        )}
        <Notice error={error} ok="" />
        <div className="form-actions">
          <button type="button" className="btn-ghost" disabled={!changed} onClick={() => setSlug(ws.slug)}>
            Reset
          </button>
          <button className="primary" disabled={busy || !changed || !status?.available}>
            {busy ? 'Saving…' : 'Save address'}
          </button>
        </div>
      </form>
    </section>
  )
}

function DomainCard({ ws, token }: { ws: Workspace; token: string }) {
  const [info, setInfo] = useState<Domain | null>(null)
  const [domain, setDomain] = useState('')
  const { error, ok, busy, run } = useAction()
  const path = `/api/workspaces/${ws.workspace_id}/domain`

  useEffect(() => {
    api<Domain>(path, { token })
      .then((d) => {
        setInfo(d)
        setDomain(d.domain ?? '')
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      setInfo(await api<Domain>(path, { method: 'PUT', token, body: JSON.stringify({ domain }) }))
      return 'Domain saved. Now add the CNAME record below at your DNS provider.'
    })
  }

  return (
    <section className="panel">
      <div className="list-head">
        <h3>Custom domain</h3>
        <span className={info?.domain ? 'badge pending' : 'badge off'}>{info?.domain ? 'Awaiting DNS' : 'Not set'}</span>
      </div>
      <p className="muted">Use your own domain for this workspace.</p>
      <form className="inline" onSubmit={save}>
        <input required placeholder="app.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <button className="primary" disabled={busy}>
          Save
        </button>
      </form>
      <Notice error={error} ok={ok} />
      {info?.domain && (
        <table className="dns">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>CNAME</td>
              <td>{info.cname_host}</td>
              <td>{info.cname_target}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  )
}

type Provider = {
  key: string
  name: string
  description: string
  enabled: boolean
  config: { idp_sso_url: string; idp_entity_id: string; certificate: string }
  sp: { entity_id: string; acs_url: string }
}

function ProviderRow({ ws, token, p, onSaved }: { ws: Workspace; token: string; p: Provider; onSaved: (p: Provider) => void }) {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState(p.config)
  const { error, ok, busy, run } = useAction()
  const path = `/api/workspaces/${ws.workspace_id}/auth-providers/${p.key}`

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const save = (enabled: boolean) =>
    run(async () => {
      const saved = await api<Provider>(path, { method: 'PUT', token, body: JSON.stringify({ enabled, ...cfg }) })
      onSaved(saved)
      setOpen(false)
    })

  return (
    <div className="pcard">
      <div className="pcard-top">
        <div className="logo-tile">
          <ProviderLogo id={p.key} />
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={p.enabled}
          aria-label={`Enable ${p.name}`}
          className={`switch ${p.enabled ? 'on' : ''}`}
          disabled={busy}
          onClick={() => (p.enabled ? save(false) : setOpen(true))}
        />
      </div>
      <strong>{p.name}</strong>
      <p className="muted">{p.description}</p>
      <div className="pcard-foot">
        <span className={`badge ${p.enabled ? '' : 'off'}`}>{p.enabled ? 'Enabled' : 'Disabled'}</span>
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Configure'}
        </button>
      </div>
      {open && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Configure ${p.name}`}>
          <div className="modal-head">
            <div className="logo-tile">
              <ProviderLogo id={p.key} />
            </div>
            <div>
              <h3>{p.name}</h3>
              <p className="muted">Configure SAML single sign-on</p>
            </div>
            <button type="button" className="icon-btn close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
        <form
          className="provider-form"
          onSubmit={(e) => {
            e.preventDefault()
            save(true)
          }}
        >
          <div className="sp">
            <strong>Add these in {p.name}</strong>
            <label>
              Entity ID (Identifier)
              <code>{p.sp.entity_id}</code>
            </label>
            <label>
              Reply URL (ACS)
              <code>{p.sp.acs_url}</code>
            </label>
          </div>
          <label className="field">
            <span>Login URL (SSO URL)</span>
            <div className="input">
              <input required placeholder="https://login.microsoftonline.com/…/saml2" value={cfg.idp_sso_url} onChange={(e) => setCfg({ ...cfg, idp_sso_url: e.target.value })} />
            </div>
          </label>
          <label className="field">
            <span>Identity provider Entity ID</span>
            <div className="input">
              <input required placeholder="https://sts.windows.net/…/" value={cfg.idp_entity_id} onChange={(e) => setCfg({ ...cfg, idp_entity_id: e.target.value })} />
            </div>
          </label>
          <label className="field">
            <span>X.509 certificate</span>
            <textarea required rows={4} placeholder="-----BEGIN CERTIFICATE-----" value={cfg.certificate} onChange={(e) => setCfg({ ...cfg, certificate: e.target.value })} />
          </label>
          <Notice error={error} ok={ok} />
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save & enable'}
            </button>
          </div>
        </form>
        </div>
        </div>
      )}
    </div>
  )
}

function ProvidersCard({ ws, token }: { ws: Workspace; token: string }) {
  const [providers, setProviders] = useState<Provider[]>([])

  useEffect(() => {
    api<Provider[]>(`/api/workspaces/${ws.workspace_id}/auth-providers`, { token })
      .then(setProviders)
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="providers">
      <h3>Single sign-on (SAML)</h3>
      <p className="muted">Let people sign in to this workspace with your identity provider.</p>
      <div className="provider-grid">
        {providers.map((p) => (
          <ProviderRow key={p.key} ws={ws} token={token} p={p} onSaved={(n) => setProviders(providers.map((x) => (x.key === n.key ? n : x)))} />
        ))}
      </div>
    </section>
  )
}

type Empty = { title: string; text: string; cta?: { label: string; to: string } }
type NavItem = { key: string; label: string; icon: IconName; blurb: string; empty?: Empty }

const MAIN_NAV: NavItem[] = [
  {
    key: 'graphs',
    label: 'Knowledge Graphs',
    icon: 'graph',
    blurb: 'Browse and manage your knowledge graphs.',
    empty: { title: 'No knowledge graphs yet', text: 'Create your first graph to start connecting your data and asking questions.', cta: { label: 'New graph', to: 'new-graph' } },
  },
  {
    key: 'new-graph',
    label: 'New Graph',
    icon: 'plus',
    blurb: 'Create a new knowledge graph.',
    empty: { title: 'Start a new graph', text: 'Choose the data your graph will be built from, then define its entities and relationships.', cta: { label: 'Browse data catalog', to: 'catalog' } },
  },
  {
    key: 'catalog',
    label: 'Data Catalog',
    icon: 'table',
    blurb: 'Explore the data sources available to your graphs.',
    empty: { title: 'Your data catalog is empty', text: 'Tables and fields from connected data sources will show up here.' },
  },
  {
    key: 'studio',
    label: 'Graph Studio',
    icon: 'pen',
    blurb: 'Design and edit graph structure.',
    empty: { title: 'Nothing to design yet', text: 'Create a graph first, then shape its structure in Graph Studio.', cta: { label: 'Create a graph', to: 'new-graph' } },
  },
  {
    key: 'ask',
    label: 'Ask a Question',
    icon: 'chat',
    blurb: 'Ask questions across your knowledge graphs.',
    empty: { title: 'No questions asked yet', text: 'Once you have a knowledge graph, ask questions about it in plain language.', cta: { label: 'View graphs', to: 'graphs' } },
  },
  {
    key: 'lenses',
    label: 'What-if Lenses',
    icon: 'flask',
    blurb: 'Explore scenarios with what-if lenses.',
    empty: { title: 'No lenses yet', text: 'Lenses let you test scenarios on top of a graph without changing it.', cta: { label: 'View graphs', to: 'graphs' } },
  },
  {
    key: 'evals',
    label: 'Validation & Evals',
    icon: 'circleCheck',
    blurb: 'Validate answers and track evaluation results.',
    empty: { title: 'No evaluations yet', text: 'Validation runs and their results will be tracked here.' },
  },
  {
    key: 'feedback',
    label: 'Feedback & Learning',
    icon: 'refresh',
    blurb: 'Review feedback and improve over time.',
    empty: { title: 'No feedback yet', text: 'Feedback on answers will appear here so your graphs can keep improving.' },
  },
]

const MANAGE_NAV: NavItem[] = [
  { key: 'users', label: 'Users', icon: 'users', blurb: 'Invite people and manage who can access this workspace.' },
  { key: 'domain', label: 'Domain', icon: 'globe', blurb: 'Change your workspace address or connect your own domain.' },
  { key: 'settings', label: 'Settings', icon: 'settings', blurb: 'Single sign-on for your workspace.' },
]

export default function WorkspaceHome({
  ws,
  userName,
  token,
  onLogout,
}: {
  ws: Workspace
  userName: string
  token: string
  onLogout: () => void
}) {
  const [tab, setTab] = useState('graphs')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar') === 'collapsed')
  const toggle = () => {
    setCollapsed(!collapsed)
    localStorage.setItem('sidebar', collapsed ? 'open' : 'collapsed')
  }
  const owner = ws.role === 'owner'
  const current = [...MAIN_NAV, ...MANAGE_NAV].find((n) => n.key === tab)!

  const link = (n: NavItem) => (
    <a key={n.key} className={tab === n.key ? 'active' : ''} onClick={() => setTab(n.key)} title={n.label}>
      <Icon name={n.icon} />
      <span className="label">{n.label}</span>
    </a>
  )

  let body
  if (tab === 'users' || tab === 'domain' || tab === 'settings') {
    body = !owner ? (
      <p className="muted">Only the workspace owner can manage users and settings.</p>
    ) : tab === 'users' ? (
      <UsersCard ws={ws} token={token} />
    ) : tab === 'domain' ? (
      <>
        <AddressCard ws={ws} token={token} />
        <DomainCard ws={ws} token={token} />
      </>
    ) : (
      <ProvidersCard ws={ws} token={token} />
    )
  } else {
    const e = current.empty!
    body = (
      <div className="empty-page">
        <div className="empty-art">
          <div className="empty-icon">
            <Icon name={current.icon} size={30} />
          </div>
        </div>
        <h3>{e.title}</h3>
        <p className="muted">{e.text}</p>
        {e.cta && tab !== 'graphs' && (
          <button className="primary" onClick={() => setTab(e.cta!.to)}>
            {e.cta.label}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`dash ${collapsed ? 'collapsed' : ''}`}>
      <aside>
        <div className="brand">
          <div className="mark sm">C</div>
          <span className="brand-name">
            Context<b>Weave</b>
          </span>
          <button className="icon-btn collapse" onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label="Toggle sidebar">
            <Icon name="panel" size={18} />
          </button>
        </div>
        <nav>
          <span className="nav-label">Explore</span>
          {MAIN_NAV.map(link)}
          <span className="nav-label spaced">Workspace</span>
          {MANAGE_NAV.map(link)}
        </nav>
        <div className="me">
          <div className="avatar">{userName.charAt(0).toUpperCase()}</div>
          <div className="me-info">
            <strong>{userName}</strong>
            <small>{ws.role}</small>
          </div>
          <button className="icon-btn" onClick={onLogout} title="Log out" aria-label="Log out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main>
        <div className="content">
          <div className="page-head">
            <div>
              <h2>{current.label}</h2>
              <p className="muted">{current.blurb}</p>
            </div>
            {tab === 'graphs' && (
              <button className="primary" onClick={() => setTab('new-graph')}>
                <Icon name="plus" size={16} /> New graph
              </button>
            )}
          </div>
          {body}
        </div>
      </main>
    </div>
  )
}
