import Redis from 'ioredis';
import request from 'supertest';
import { createApp, cookieValue, NEW_PASSWORD } from './helpers';
import { RateLimiter } from '../src/common/rate-limiter';
import { setRedisForTest, withLock } from '../src/redis/redis';
import { createCsrfToken, verifyCsrfToken } from '../src/auth/cookies';
import { mimeMatchesContent, sniffFileType } from '../src/storage/storage.service';
import { assertProductionConfig } from '../src/config/production-config';
import { parseCsv, randomPassword } from '../scripts/create-users';

// batas webhook kecil untuk uji (dibaca saat guard dibuat)
process.env.WEBHOOK_RATE_LIMIT = '3';

let ctx: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  ctx = await createApp();
});
afterAll(async () => {
  await ctx.app.close();
});

describe('CSRF bertanda tangan HMAC (COOKIE_SECRET)', () => {
  it('token buatan server valid; token tanpa tanda tangan / diubah ditolak', () => {
    const t = createCsrfToken();
    expect(verifyCsrfToken(t)).toBe(true);
    expect(verifyCsrfToken('forged')).toBe(false);
    expect(verifyCsrfToken(`${t.split('.')[0]}.AAAA`)).toBe(false);
  });

  it('cookie = header tetapi tidak ditandatangani (mis. disuntik subdomain lain) → 403', async () => {
    const login = await request(ctx.app.getHttpServer()).post('/api/auth/login').send({ email: 'pm@indotek.test', password: NEW_PASSWORD }).expect(200);
    const access = cookieValue(login, 'access_token')!;
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', [`access_token=${access}`, 'csrf_token=palsu123'])
      .set('X-CSRF-Token', 'palsu123')
      .expect(403);
    expect(res.body.code).toBe('CSRF');
  });
});

describe('Rate limiter', () => {
  it('in-memory (tanpa REDIS_URL): 5 percobaan lalu 429', async () => {
    const rl = new RateLimiter('rl:uji', 5, 60_000);
    for (let i = 0; i < 5; i++) expect((await rl.hit('k', 1000 + i)).allowed).toBe(true);
    const r = await rl.hit('k', 2000);
    expect(r).toMatchObject({ allowed: false, store: 'memory' });
    expect(r.retryAfter).toBeGreaterThan(0);
  });

  const redisUrl = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379';
  it('Redis: dua replika (dua koneksi berbeda) berbagi hitungan yang sama', async () => {
    const a = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    const b = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await a.connect();
      await b.connect();
    } catch {
      console.warn(`Redis tidak tersedia di ${redisUrl} — uji Redis dilewati`);
      a.disconnect();
      b.disconnect();
      return;
    }
    const key = `uji-${Date.now()}`;
    const replika1 = new RateLimiter('rl:uji2', 5, 60_000);
    const replika2 = new RateLimiter('rl:uji2', 5, 60_000);
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      setRedisForTest(i % 2 === 0 ? a : b); // bergantian seperti load balancer round-robin
      const r = await (i % 2 === 0 ? replika1 : replika2).hit(key);
      expect(r.store).toBe('redis');
      results.push(r.allowed);
    }
    expect(results).toEqual([true, true, true, true, true, false]);
    // lock: dua pemegang berurutan, tidak bersamaan
    const order: string[] = [];
    setRedisForTest(a);
    await Promise.all(
      ['x', 'y'].map((n) =>
        withLock(`lock:uji-${key}`, 5_000, async () => {
          order.push(`${n}-mulai`);
          await new Promise((res) => setTimeout(res, 150));
          order.push(`${n}-selesai`);
        }),
      ),
    );
    expect(order[1]).toMatch(/-selesai$/);
    expect(order[3]).toMatch(/-selesai$/);
    setRedisForTest(undefined);
    await a.del(`rl:uji2:${key}`);
    a.disconnect();
    b.disconnect();
  });
});

describe('Rate limit webhook per API key', () => {
  it('batas WEBHOOK_RATE_LIMIT (uji: 3) → kiriman ke-4 dalam satu menit 429', async () => {
    const key = (await ctx.api('admin').post('/api-keys', { name: 'Uji rate limit' }).expect(201)).body.key as string;
    const post = () =>
      request(ctx.app.getHttpServer()).post('/api/webhooks/expenses').set('X-API-Key', key).send({ cluster: 'Tidak Ada', kategori: 'OPS', nominal: 1, tanggal: '2026-10-15' });
    for (let i = 0; i < 3; i++) expect((await post()).status).toBe(422);
    const blocked = await post().expect(429);
    expect(blocked.body.code).toBe('RATE_LIMIT');
  });
});

describe('Validasi upload dari isi file', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  it('magic bytes', () => {
    expect(sniffFileType(PNG)).toBe('png');
    expect(sniffFileType(Buffer.from('%PDF-1.7'))).toBe('pdf');
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(mimeMatchesContent('image/png', PNG)).toBe(true);
    expect(mimeMatchesContent('image/png', Buffer.from('%PDF-1.7'))).toBe(false);
    expect(mimeMatchesContent('application/pdf', Buffer.from('<html>'))).toBe(false);
  });

  it('lampiran pengajuan dengan isi tidak sesuai jenis → 400', async () => {
    const cluster = await ctx.prisma.cluster.findFirstOrThrow();
    const fr = await ctx.api('pm').post('/fund-requests', { clusterId: cluster.id }).expect(201);
    const { srv, auth } = ctx.api('pm').raw();
    const res = await srv
      .post(`/api/fund-requests/${fr.body.id}/attachments`)
      .set(auth)
      .field('kind', 'LAINNYA')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'nota.png', contentType: 'image/png' })
      .expect(400);
    expect(res.body.message).toMatch(/Isi file tidak sesuai/);
    await ctx.api('pm').del(`/fund-requests/${fr.body.id}`).expect(200);
  });
});

describe('Health & konfigurasi production', () => {
  it('/api/health melaporkan db & redis', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ ok: true, checks: { db: 'ok', redis: 'disabled' } });
  });

  it('NODE_ENV=production: secret wajib, bukan default dev, REDIS_URL wajib', () => {
    const good = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
      COOKIE_SECRET: 'c'.repeat(48),
      DATABASE_URL: 'postgresql://x',
      REDIS_URL: 'redis://redis:6379',
    };
    expect(() => assertProductionConfig(good)).not.toThrow();
    expect(() => assertProductionConfig({ ...good, COOKIE_SECRET: 'pendek' })).toThrow(/COOKIE_SECRET/);
    expect(() => assertProductionConfig({ ...good, JWT_ACCESS_SECRET: 'dev-access-secret-ganti-di-produksi-xxxxxxxxxx' })).toThrow(/default dev/);
    expect(() => assertProductionConfig({ ...good, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
    expect(() => assertProductionConfig({ ...good, NODE_ENV: 'development', COOKIE_SECRET: '' })).not.toThrow();
  });
});

describe('create-users CSV', () => {
  it('CSV dengan kutip & koma; password acak 16 karakter', () => {
    expect(parseCsv('nama,email,role,jabatan,projects\n"Budi, S.T.",budi@x.id,PM,"Project ""A""",\nSiti,siti@x.id,INVESTOR,,ADW;CCSI\n')).toEqual([
      ['nama', 'email', 'role', 'jabatan', 'projects'],
      ['Budi, S.T.', 'budi@x.id', 'PM', 'Project "A"', ''],
      ['Siti', 'siti@x.id', 'INVESTOR', '', 'ADW;CCSI'],
    ]);
    const p = randomPassword();
    expect(p).toHaveLength(16);
    expect(randomPassword()).not.toBe(p);
  });
});
