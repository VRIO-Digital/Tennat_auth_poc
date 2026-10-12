export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// Workspaces live at {slug}.{baseDomain}. The value comes from the backend
// (BASE_DOMAIN there) so it is configured in one place only.
export const config = { baseDomain: 'localhost:5173' }

export async function loadConfig() {
  try {
    const res = await fetch(`${API_URL}/api/config`, { signal: AbortSignal.timeout(20000) })
    if (res.ok) config.baseDomain = (await res.json()).base_domain
  } catch {
    // keep the default; the app still works on the main site
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit & { token?: string | null },
): Promise<T> {
  const { token, ...rest } = init ?? {}
  const res = await fetch(path.startsWith('http') ? path : `${API_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = (body as { detail?: unknown }).detail
    throw new Error(
      typeof d === 'string' ? d : Array.isArray(d) ? 'Please check the form fields' : `${res.status} ${res.statusText}`,
    )
  }
  return body as T
}

export type User = { id: number; name: string; email: string; email_verified: boolean }
export type Workspace = { workspace_id: number; name: string; slug: string; role: string; url: string }
