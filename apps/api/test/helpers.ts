import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'Indotek123!';
export type RoleKey = 'admin' | 'pm' | 'finance' | 'direktur' | 'investor';

export async function createApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  setupApp(app);
  await app.init();
  const tokens = {} as Record<RoleKey, string>;
  for (const k of ['admin', 'pm', 'finance', 'direktur', 'investor'] as RoleKey[]) {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `${k}@indotek.test`, password: PASSWORD })
      .expect(200);
    tokens[k] = res.body.accessToken;
  }
  const api = (who: RoleKey) => {
    const srv = app.getHttpServer();
    const auth = { Authorization: `Bearer ${tokens[who]}` };
    return {
      get: (url: string) => request(srv).get(`/api${url}`).set(auth),
      post: (url: string, body?: object) => request(srv).post(`/api${url}`).set(auth).send(body ?? {}),
      patch: (url: string, body?: object) => request(srv).patch(`/api${url}`).set(auth).send(body ?? {}),
      put: (url: string, body?: unknown) => request(srv).put(`/api${url}`).set(auth).send(body as object),
      del: (url: string) => request(srv).delete(`/api${url}`).set(auth),
      raw: () => ({ srv, auth }),
    };
  };
  return { app, api, prisma: app.get(PrismaService) };
}

export async function clusterId(prisma: PrismaService, projectCode: string, name: string) {
  const c = await prisma.cluster.findFirstOrThrow({ where: { name, project: { code: projectCode } } });
  return c.id;
}

/** Parser biner untuk respons file (PDF/XLSX) di supertest. */
export function binaryParser(res: NodeJS.ReadableStream & { setEncoding(e: string): void }, cb: (e: Error | null, b: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
