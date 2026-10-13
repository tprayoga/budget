import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'Indotek123!';
/** Password setelah ganti password wajib di login pertama. */
export const NEW_PASSWORD = 'IndotekBaru2026';
export type RoleKey = 'admin' | 'pm' | 'finance' | 'direktur' | 'investor';
export type Agent = ReturnType<typeof request.agent>;

/** Ambil nilai cookie dari header Set-Cookie respons. */
export function cookieValue(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.split(';')[0].slice(name.length + 1)) : null;
}

/**
 * Login sebagai user demo memakai cookie (agent supertest). Bila wajib ganti password,
 * langsung ganti ke NEW_PASSWORD. Mengembalikan agent + token CSRF.
 */
export async function loginAgent(srv: Parameters<typeof request.agent>[0], email: string) {
  const agent = request.agent(srv);
  let res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status === 401) res = await agent.post('/api/auth/login').send({ email, password: NEW_PASSWORD });
  if (res.status !== 200) throw new Error(`Login ${email} gagal: ${res.status} ${JSON.stringify(res.body)}`);
  let csrf = cookieValue(res, 'csrf_token')!;
  if (res.body.user.mustChangePassword) {
    res = await agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    if (res.status !== 200) throw new Error(`Ganti password ${email} gagal: ${JSON.stringify(res.body)}`);
    csrf = cookieValue(res, 'csrf_token')!;
  }
  return { agent, csrf };
}

export async function createApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  setupApp(app);
  await app.init();
  const sessions = {} as Record<RoleKey, { agent: Agent; csrf: string }>;
  for (const k of ['admin', 'pm', 'finance', 'direktur', 'investor'] as RoleKey[]) {
    sessions[k] = await loginAgent(app.getHttpServer(), `${k}@indotek.test`);
  }
  const api = (who: RoleKey) => {
    const { agent, csrf } = sessions[who];
    const h = { 'X-CSRF-Token': csrf };
    return {
      get: (url: string) => agent.get(`/api${url}`),
      post: (url: string, body?: object) => agent.post(`/api${url}`).set(h).send(body ?? {}),
      patch: (url: string, body?: object) => agent.patch(`/api${url}`).set(h).send(body ?? {}),
      put: (url: string, body?: unknown) => agent.put(`/api${url}`).set(h).send(body as object),
      del: (url: string) => agent.delete(`/api${url}`).set(h),
      /** agent ber-cookie + header CSRF, untuk request multipart/biner */
      raw: () => ({ srv: agent, auth: h }),
    };
  };
  return { app, api, prisma: app.get(PrismaService) };
}

export async function clusterId(prisma: PrismaService, projectCode: string, name: string) {
  const c = await prisma.cluster.findFirstOrThrow({ where: { name, project: { code: projectCode } } });
  return c.id;
}

/** Parser biner untuk respons file (PDF/XLSX) di supertest. */
export const binaryParser: Parameters<request.Test['parse']>[0] = (res, cb) => {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
};
