import type { CookieOptions, Response } from 'express';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
/** Cookie CSRF sengaja TIDAK httpOnly: dibaca JS lalu dikirim ulang di header (double-submit). */
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

/** "15m" / "1h" / "30s" / "7d" → milidetik. */
export function parseDuration(v: string | undefined, fallbackMs: number): number {
  const m = v?.trim().match(/^(\d+)\s*([smhd])$/);
  if (!m) return fallbackMs;
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * unit;
}

export const accessTtlMs = () => parseDuration(process.env.JWT_ACCESS_TTL, 15 * 60_000);
export const refreshTtlMs = () => Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7) * 86_400_000;

/** Secure default true; set COOKIE_SECURE=false hanya untuk akses HTTP non-localhost di lingkungan dev/test. */
function base(): CookieOptions {
  return { secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'lax' };
}

export function setAuthCookies(res: Response, t: { accessToken: string; refreshToken: string; csrfToken: string }) {
  res.cookie(ACCESS_COOKIE, t.accessToken, { ...base(), httpOnly: true, path: '/api', maxAge: accessTtlMs() });
  res.cookie(REFRESH_COOKIE, t.refreshToken, { ...base(), httpOnly: true, path: '/api/auth', maxAge: refreshTtlMs() });
  res.cookie(CSRF_COOKIE, t.csrfToken, { ...base(), httpOnly: false, path: '/', maxAge: refreshTtlMs() });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), httpOnly: true, path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), httpOnly: true, path: '/api/auth' });
  res.clearCookie(CSRF_COOKIE, { ...base(), path: '/' });
}
