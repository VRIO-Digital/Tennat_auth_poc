import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, BASE_DOMAIN, type User, type Workspace } from './lib/api'
import WorkspaceHome from './WorkspaceHome'
import Icon, { type IconName } from './Icon'
import './App.css'

type Step = 'register' | 'verify' | 'login' | 'dashboard'

const TOKEN_KEY = 'token'

function Logo({ subtitle }: { subtitle: string }) {
  return (
    <div className="logo">
      <div className="mark">C</div>
      <h1>
        Context<span>Weave</span>
      </h1>
      <p>{subtitle}</p>
    </div>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  suffix?: string
  icon?: IconName
}) {
  const [show, setShow] = useState(false)
  const isPw = props.type === 'password'
  return (
    <label className="field">
      <span>{props.label}</span>
      <div className="input">
        {props.icon && <Icon name={props.icon} />}
        <input
          type={isPw && show ? 'text' : (props.type ?? 'text')}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
          required
        />
        {isPw && (
          <button type="button" className="eye" onClick={() => setShow(!show)} aria-label="Toggle password">
            <Icon name={show ? 'eyeOff' : 'eye'} />
          </button>
        )}
        {props.suffix && <em>{props.suffix}</em>}
      </div>
    </label>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Tenant subdomain, e.g. "acme" for acme.<BASE_DOMAIN>
const tenantSlug = (() => {
  const suffix = `.${BASE_DOMAIN}`
  if (!location.host.endsWith(suffix)) return null
  const slug = location.host.slice(0, -suffix.length)
  return slug && !slug.includes('.') ? slug : null
})()

// Token handed over from the main site after login (storage is per subdomain)
const hashToken = new URLSearchParams(location.hash.slice(1)).get('token')
if (hashToken) {
  localStorage.setItem(TOKEN_KEY, hashToken)
  history.replaceState(null, '', location.pathname)
}

const randomSuffix = () => Math.random().toString(36).slice(2, 6)

function App() {
  const [step, setStep] = useState<Step>('login')
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [tenant, setTenant] = useState<{ name: string } | 'missing' | null>(null)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [vToken, setVToken] = useState('')
  const [devToken, setDevToken] = useState('')
  const [copied, setCopied] = useState(false)
  const [remember, setRemember] = useState(true)

  async function run(fn: () => Promise<void>) {
    setError('')
    setInfo('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function loadSession(t: string) {
    const me = await api<User>('/api/auth/me', { token: t })
    let list = await api<Workspace[]>('/api/workspaces', { token: t })
    if (tenantSlug) {
      list = list.filter((w) => w.slug === tenantSlug)
      if (!list.length) throw new Error('You do not have access to this workspace')
    }
    setUser(me)
    if (!list.length) {
      const wsName = `${me.name}'s Workspace`
      for (let i = 0; i < 5; i++) {
        try {
          await api('/api/workspaces', {
            method: 'POST',
            token: t,
            body: JSON.stringify({ name: wsName, slug: `${slugify(wsName) || 'workspace'}-${randomSuffix()}` }),
          })
          break
        } catch (e) {
          if (!(e as Error).message.includes('already exists')) throw e
        }
      }
      list = await api<Workspace[]>('/api/workspaces', { token: t })
    }
    // Main site: send the user to their workspace subdomain
    if (!tenantSlug) {
      location.href = `${list[0].url}/#token=${encodeURIComponent(t)}`
      return
    }
    setWorkspaces(list)
    setStep('dashboard')
  }

  // Resolve the tenant from the subdomain
  useEffect(() => {
    if (!tenantSlug) return
    api<{ name: string }>(`/api/workspaces/by-slug/${tenantSlug}`)
      .then(setTenant)
      .catch((e: Error) => (e.message === 'Workspace not found' ? setTenant('missing') : setError(`Cannot reach the API: ${e.message}`)))
  }, [])

  // Restore an existing session
  useEffect(() => {
    if (!token) return
    loadSession(token).catch((e: Error) => {
      localStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(TOKEN_KEY)
      setToken(null)
      setError(e.message)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goto = (s: Step) => {
    setError('')
    setInfo('')
    setStep(s)
  }

  const register = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      const r = await api<{ verification_url?: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      })
      setDevToken(r.verification_url ? (new URL(r.verification_url).searchParams.get('token') ?? '') : '')
      setStep('verify')
    })
  }

  const verifyToken = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      await api(`/api/auth/verify-email?token=${encodeURIComponent(vToken.trim())}`)
      setVToken('')
      setPassword('')
      setStep('login')
      setInfo('Email verified. Please log in.')
    })
  }

  const login = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      const r = await api<{ access_token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      ;(remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, r.access_token)
      setToken(r.access_token)
      await loadSession(r.access_token)
    })
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
    setPassword('')
    goto('login')
  }

  const msgs = (
    <>
      {error && <div className="msg error">{error}</div>}
      {info && <div className="msg ok">{info}</div>}
    </>
  )

  if (tenantSlug && !tenant && error.startsWith('Cannot reach')) {
    return (
      <div className="page">
        <Card>
          <h2 className="center">Can't load workspace</h2>
          <p className="center muted">{error}</p>
          <button className="primary" onClick={() => location.reload()}>
            Retry
          </button>
        </Card>
      </div>
    )
  }

  if (tenant === 'missing') {
    return (
      <div className="page">
        <Card>
          <h2 className="center">Workspace not found</h2>
          <p className="center muted">No workspace exists at {location.host}.</p>
        </Card>
      </div>
    )
  }

  if (step === 'dashboard' && user && token) {
    return <WorkspaceHome ws={workspaces[0]} userName={user.name} token={token} onLogout={logout} />
  }

  return (
    <div className="page">
      {step === 'register' && (
        <Card>
          <Logo subtitle="Create your account" />
          <form onSubmit={register}>
            <Field label="Name" icon="user" value={name} onChange={setName} placeholder="Roshan Cheeyapana" />
            <Field label="Email" icon="mail" type="email" value={email} onChange={setEmail} placeholder="roshan@example.com" />
            <Field label="Password" icon="lock" type="password" value={password} onChange={setPassword} />
            {msgs}
            <button className="primary" disabled={busy}>
              Create Account
            </button>
          </form>
          <p className="alt">
            Already have an account? <button className="link" onClick={() => goto('login')}>Login</button>
          </p>
        </Card>
      )}

      {step === 'verify' && (
        <Card>
          <div className="check"><Icon name="mail" size={28} /></div>
          <h2 className="center">Verify your email</h2>
          <p className="center muted">
            We've sent a verification link to
            <br />
            <strong>{email}</strong>
          </p>
          <div className="or">OR</div>
          <div className="hint">
            <strong>For testing, you can paste the token here</strong>
            <br />
            Paste the token from your email to verify manually.
          </div>
          {devToken && (
            <div className="token">
              <code>{devToken}</code>
              <button
                type="button"
                className="copy"
                onClick={() => {
                  navigator.clipboard.writeText(devToken)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} size={14} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
          <form onSubmit={verifyToken}>
            <Field label="Verification Token" icon="link" value={vToken} onChange={setVToken} placeholder="Paste your verification token here" />
            {msgs}
            <button className="blue" disabled={busy}>
              Verify Token
            </button>
          </form>
          <p className="alt">
            Didn't receive the email? <button className="link" onClick={() => setInfo('Resend is not available yet')}>Resend</button>
          </p>
        </Card>
      )}

      {step !== 'dashboard' && <p className="foot">© ContextWeave</p>}

      {step === 'login' && (
        <Card>
          <Logo subtitle="Welcome back! Sign in to continue." />
          {tenant && (
            <div className="tenant-chip">
              <div className="avatar sq">{tenant.name.charAt(0).toUpperCase()}</div>
              <div>
                <small>Signing in to</small>
                <strong>{tenant.name}</strong>
              </div>
            </div>
          )}
          <form onSubmit={login}>
            <Field label="Email" icon="mail" type="email" value={email} onChange={setEmail} placeholder="roshan@example.com" />
            <Field label="Password" icon="lock" type="password" value={password} onChange={setPassword} />
            <div className="row">
              <label>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me
              </label>
              <button type="button" className="link" onClick={() => setInfo('Password reset is not available yet')}>
                Forgot password?
              </button>
            </div>
            {msgs}
            <button className="primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="alt">
            Don't have an account? <button className="link" onClick={() => goto('register')}>Register</button>
          </p>
        </Card>
      )}
    </div>
  )
}

export default App
