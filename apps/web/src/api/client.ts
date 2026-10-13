const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const CSRF_COOKIE = 'csrf_token';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Token sesi disimpan API di cookie httpOnly (tidak bisa dibaca JS). Untuk request yang mengubah data,
 * nilai cookie csrf_token dikirim ulang di header X-CSRF-Token (double-submit).
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

export function readCsrfToken(): string | null {
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return m ? decodeURIComponent(m.slice(CSRF_COOKIE.length + 1)) : null;
}

let refreshing: Promise<boolean> | null = null;
let onLogout: (() => void) | null = null;
let onPasswordChangeRequired: (() => void) | null = null;
export function setSessionHandlers(h: { logout: () => void; passwordChangeRequired: () => void }) {
  onLogout = h.logout;
  onPasswordChangeRequired = h.passwordChangeRequired;
}

function withCsrf(init: RequestInit): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!SAFE.has(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return { ...init, headers, credentials: 'same-origin' };
}

/** Perbarui sesi memakai refresh token di cookie (satu permintaan bersamaan). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, withCsrf({ method: 'POST' }))
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, withCsrf(init));
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) return raw(path, init, false);
    onLogout?.();
  }
  if (!res.ok) {
    let body: Record<string, unknown> | null = null;
    try {
      body = await res.json();
    } catch {
      /* bukan JSON */
    }
    if (res.status === 403 && body?.code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChangeRequired?.();
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

/** Unduh file (PDF/XLSX) memakai sesi cookie lalu buka/simpan. */
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
