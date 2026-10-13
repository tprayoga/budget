import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { cookieValue, createApp, loginAgent, NEW_PASSWORD } from './helpers';

let ctx: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  ctx = await createApp();
});
afterAll(async () => {
  await ctx.app.close();
});

const srv = () => ctx.app.getHttpServer();

describe('Cookie httpOnly + CSRF', () => {
  it('login menyetel cookie httpOnly; body tanpa token', async () => {
    const res = await request(srv()).post('/api/auth/login').send({ email: 'pm@indotek.test', password: NEW_PASSWORD }).expect(200);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.user.email).toBe('pm@indotek.test');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const find = (n: string) => cookies.find((c) => c.startsWith(`${n}=`))!;
    expect(find('access_token')).toMatch(/HttpOnly/i);
    expect(find('access_token')).toMatch(/SameSite=Lax/i);
    expect(find('access_token')).toMatch(/Path=\/api(;|$)/);
    expect(find('refresh_token')).toMatch(/HttpOnly/i);
    expect(find('refresh_token')).toMatch(/Path=\/api\/auth/);
    expect(find('csrf_token')).not.toMatch(/HttpOnly/i);
  });

  it('cookie Secure aktif secara default (COOKIE_SECURE != false)', async () => {
    const prev = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = 'true';
    try {
      const res = await request(srv()).post('/api/auth/login').send({ email: 'pm@indotek.test', password: NEW_PASSWORD }).expect(200);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.every((c) => /;\s*Secure/i.test(c))).toBe(true);
    } finally {
      process.env.COOKIE_SECURE = prev;
    }
  });

  it('token di header Authorization tidak diterima', async () => {
    const res = await request(srv()).post('/api/auth/login').send({ email: 'pm@indotek.test', password: NEW_PASSWORD }).expect(200);
    const access = cookieValue(res, 'access_token');
    await request(srv()).get('/api/projects').set('Authorization', `Bearer ${access}`).expect(401);
  });

  it('request yang mengubah data tanpa / dengan token CSRF salah → 403', async () => {
    const { agent, csrf } = await loginAgent(srv(), 'pm@indotek.test');
    const c = await ctx.prisma.cluster.findFirstOrThrow();
    const noCsrf = await agent.patch(`/api/clusters/${c.id}`).send({ info: 'x' }).expect(403);
    expect(noCsrf.body.code).toBe('CSRF');
    await agent.patch(`/api/clusters/${c.id}`).set('X-CSRF-Token', 'salah').send({ info: 'x' }).expect(403);
    // GET tetap jalan tanpa header CSRF
    await agent.get(`/api/clusters/${c.id}`).expect(200);
    await agent.patch(`/api/clusters/${c.id}`).set('X-CSRF-Token', csrf).send({ info: c.info }).expect(200);
  });

  it('refresh merotasi token; refresh token lama tidak bisa dipakai ulang; logout mencabut sesi', async () => {
    const { agent, csrf } = await loginAgent(srv(), 'finance@indotek.test');
    const r1 = await agent.post('/api/auth/refresh').set('X-CSRF-Token', csrf).expect(200);
    const oldRefresh = cookieValue(r1, 'refresh_token');
    const csrf2 = cookieValue(r1, 'csrf_token')!;
    const r2 = await agent.post('/api/auth/refresh').set('X-CSRF-Token', csrf2).expect(200);
    expect(cookieValue(r2, 'refresh_token')).not.toBe(oldRefresh);
    await request(srv())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${oldRefresh}`, `csrf_token=${csrf2}`])
      .set('X-CSRF-Token', csrf2)
      .expect(401);
    const csrf3 = cookieValue(r2, 'csrf_token')!;
    await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf3).expect(204);
    await agent.get('/api/auth/me').expect(401);
    // cookie dihapus dan refresh token terakhir dicabut di DB
    const lastRefresh = cookieValue(r2, 'refresh_token')!;
    const hash = (await import('node:crypto')).createHash('sha256').update(lastRefresh).digest('hex');
    const stored = await ctx.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(stored.revokedAt).not.toBeNull();
    await request(srv())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${lastRefresh}`, `csrf_token=${csrf3}`])
      .set('X-CSRF-Token', csrf3)
      .expect(401);
  });
});

describe('Wajib ganti password & kebijakan password', () => {
  it('user baru wajib ganti password sebelum memakai aplikasi', async () => {
    await ctx.api('admin').post('/users', { name: 'User Baru', email: 'baru@indotek.test', password: 'Sementara123', role: 'PM' }).expect(201);
    const agent = request.agent(srv());
    const login = await agent.post('/api/auth/login').send({ email: 'baru@indotek.test', password: 'Sementara123' }).expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const csrf = cookieValue(login, 'csrf_token')!;
    const blocked = await agent.get('/api/projects').expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await agent.get('/api/auth/me').expect(200);

    // password lemah / sama / password lama salah ditolak
    await agent.post('/api/auth/change-password').set('X-CSRF-Token', csrf).send({ currentPassword: 'Sementara123', newPassword: 'pendek1' }).expect(400);
    await agent.post('/api/auth/change-password').set('X-CSRF-Token', csrf).send({ currentPassword: 'Sementara123', newPassword: 'tanpaangkasama' }).expect(400);
    await agent.post('/api/auth/change-password').set('X-CSRF-Token', csrf).send({ currentPassword: 'Sementara123', newPassword: 'Sementara123' }).expect(400);
    await agent.post('/api/auth/change-password').set('X-CSRF-Token', csrf).send({ currentPassword: 'salah', newPassword: 'PasswordBaru2026' }).expect(400);

    const ok = await agent.post('/api/auth/change-password').set('X-CSRF-Token', csrf).send({ currentPassword: 'Sementara123', newPassword: 'PasswordBaru2026' }).expect(200);
    expect(ok.body.user.mustChangePassword).toBe(false);
    await agent.get('/api/projects').expect(200);
    const log = await ctx.prisma.auditLog.findFirst({ where: { entity: 'User', field: 'password' }, orderBy: { at: 'desc' } });
    expect(log?.newValue).toBe('diganti');
    expect(log?.oldValue).toBe('***');
  });
});

describe('Rate limit /auth/login', () => {
  it('maks 5 percobaan per menit per IP+email', async () => {
    for (let i = 0; i < 5; i++) {
      await request(srv()).post('/api/auth/login').send({ email: 'direktur@indotek.test', password: `salah-${i}` }).expect(401);
    }
    const blocked = await request(srv()).post('/api/auth/login').send({ email: 'direktur@indotek.test', password: NEW_PASSWORD }).expect(429);
    expect(blocked.body.code).toBe('RATE_LIMIT');
    // email lain dari IP yang sama tidak terpengaruh
    await request(srv()).post('/api/auth/login').send({ email: 'finance@indotek.test', password: NEW_PASSWORD }).expect(200);
  });
});

describe('Setting khusus project: hanya ADMIN & DIREKTUR', () => {
  it('PM ditolak; DIREKTUR boleh dan tercatat di audit', async () => {
    const p = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'CCSI' } });
    await ctx.api('pm').put(`/projects/${p.id}/settings`, { interestRate: '0.12' }).expect(403);
    await ctx.api('finance').put(`/projects/${p.id}/settings`, { interestRate: '0.12' }).expect(403);
    await ctx.api('direktur').put(`/projects/${p.id}/settings`, { interestRate: '0.12' }).expect(200);
    const log = await ctx.prisma.auditLog.findFirst({
      where: { entity: 'Setting', field: 'interestRate', newValue: '0.12' },
      orderBy: { at: 'desc' },
      include: { user: true },
    });
    expect(log?.user?.role).toBe('DIREKTUR');
    const budget = await ctx.api('pm').get(`/projects/${p.id}/budget`).expect(200);
    expect(budget.body.setting.interestRate).toBe('0.12');
    await ctx.api('admin').put(`/projects/${p.id}/settings`, { interestRate: null }).expect(200);
  });
});

describe('Seed production: tanpa user demo', () => {
  it('NODE_ENV=production → hanya admin awal dari env (wajib ganti password), tanpa cluster contoh', async () => {
    const url = 'postgresql://indotek:indotek@localhost:5432/indotek_budget_prodseed?schema=public';
    const cwd = path.resolve(__dirname, '..');
    const env = {
      ...process.env,
      DATABASE_URL: url,
      NODE_ENV: 'production',
      INITIAL_ADMIN_EMAIL: 'owner@indotek.test',
      INITIAL_ADMIN_PASSWORD: 'AwalProduksi2026',
    };
    execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd, env, stdio: 'pipe' });
    execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd, env, stdio: 'pipe' });
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
      const users = await db.user.findMany();
      expect(users.map((u) => u.email)).toEqual(['owner@indotek.test']);
      expect(users[0]).toMatchObject({ role: 'ADMIN', mustChangePassword: true });
      expect(await db.cluster.count()).toBe(0);
      expect(await db.project.count()).toBe(3);
    } finally {
      await db.$disconnect();
    }
  }, 120_000);
});
