import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';

/**
 * Log terstruktur JSON (pino) — satu baris per request + log aplikasi. Data sensitif disamarkan:
 * cookie, Authorization, X-API-Key, X-CSRF-Token, password. Request health check tidak dicatat.
 * LOG_LEVEL: trace|debug|info|warn|error|silent (default info; silent di Jest).
 */
export function loggerParams(): Params {
  const level = process.env.LOG_LEVEL ?? (process.env.JEST_WORKER_ID ? 'silent' : 'info');
  return {
    pinoHttp: {
      level,
      genReqId: (req: IncomingMessage) => (req.headers['x-request-id'] as string) || randomUUID(),
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
        ],
        censor: '[disamarkan]',
      },
      autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/health') },
      customProps: () => ({ app: 'indotek-api', version: process.env.APP_VERSION ?? 'dev' }),
      serializers: {
        req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({ id: req.id, method: req.method, url: req.url, ip: req.remoteAddress }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
