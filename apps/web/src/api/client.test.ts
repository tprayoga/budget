import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, readCsrfToken } from './client';

function mockFetch(responses: Response[]) {
  const fn = vi.fn(async () => responses.shift()!);
  vi.stubGlobal('fetch', fn);
  return fn;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('api client (sesi cookie + CSRF)', () => {
  it('POST mengirim X-CSRF-Token dari cookie; GET tidak', async () => {
    document.cookie = 'csrf_token=abc123; path=/';
    expect(readCsrfToken()).toBe('abc123');
    const f = mockFetch([json(200, { ok: 1 }), json(200, { ok: 2 })]);
    await api('/x', { method: 'POST', json: { a: 1 } });
    await api('/y');
    const [, postInit] = f.mock.calls[0] as unknown as [string, RequestInit];
    const [, getInit] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(postInit.headers).get('X-CSRF-Token')).toBe('abc123');
    expect(postInit.credentials).toBe('same-origin');
    expect(new Headers(getInit.headers).get('X-CSRF-Token')).toBeNull();
  });

  it('401 → refresh sesi lalu ulangi request sekali', async () => {
    const f = mockFetch([json(401, { message: 'exp' }), json(200, { user: {} }), json(200, { ok: true })]);
    const res = await api<{ ok: boolean }>('/projects');
    expect(res.ok).toBe(true);
    expect((f.mock.calls as unknown as [string][]).map((c) => c[0])).toEqual(['/api/projects', '/api/auth/refresh', '/api/projects']);
  });
});
