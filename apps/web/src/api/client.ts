const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const KEY = 'indotek.auth';

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

export function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function saveAuth(a: StoredAuth | null) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage tidak tersedia */
  }
}

let refreshing: Promise<boolean> | null = null;
let onLogout: (() => void) | null = null;
export function setLogoutHandler(fn: () => void) {
  onLogout = fn;
}

async function refresh(): Promise<boolean> {
  const auth = loadAuth();
  if (!auth) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const j = await r.json();
      saveAuth({ accessToken: j.accessToken, refreshToken: j.refreshToken });
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const auth = loadAuth();
  const headers = new Headers(init.headers);
  if (auth) headers.set('Authorization', `Bearer ${auth.accessToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401 && retry && auth && !path.startsWith('/auth/')) {
    if (await refresh()) return raw(path, init, false);
    saveAuth(null);
    onLogout?.();
  }
  if (!res.ok) {
    let body: Record<string, unknown> | null = null;
    try {
      body = await res.json();
    } catch {
      /* bukan JSON */
    }
    const msg = body?.message;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join(', ') : String(msg ?? res.statusText), body);
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await raw(path, json !== undefined ? { ...rest, body: JSON.stringify(json) } : rest);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Unduh file (PDF/XLSX) dengan header Authorization lalu buka/simpan. */
export async function download(path: string, fallbackName: string, open = false) {
  const res = await raw(path);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = decodeURIComponent(cd.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName);
  const url = URL.createObjectURL(blob);
  if (open) {
    const w = window.open(url, '_blank');
    if (!w) triggerDownload(url, name);
  } else {
    triggerDownload(url, name);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function triggerDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const errors = e.body?.errors as { path: string; message: string }[] | undefined;
    if (errors?.length) return errors.map((x) => (x.path ? `${x.path}: ${x.message}` : x.message)).join('; ');
    return e.message;
  }
  return e instanceof Error ? e.message : 'Terjadi kesalahan';
}
