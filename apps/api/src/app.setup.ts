import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { hostname } from 'node:os';

/** Konfigurasi bersama untuk main.ts dan test e2e. */
export function setupApp(app: INestApplication) {
  app.use(cookieParser());
  // Uji multi-replika: header X-Instance menunjukkan replika API yang melayani (hanya bila EXPOSE_INSTANCE=true)
  if (process.env.EXPOSE_INSTANCE === 'true') {
    const name = hostname();
    app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
      res.setHeader('X-Instance', name);
      next();
    });
  }
  // foto nota base64 dari webhook bisa beberapa MB
  (app as NestExpressApplication).useBodyParser('json', { limit: `${Number(process.env.UPLOAD_MAX_MB ?? 10) + 4}mb` });
  // di belakang nginx: pakai X-Forwarded-For untuk IP klien (rate limit login)
  (app as NestExpressApplication).set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
    credentials: true,
  });
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Indotek Project Budget System API')
    .setDescription(
      'Budget per cluster, pengajuan dana investor, approval, import/export. Autentikasi via cookie httpOnly; ' +
        'request yang mengubah data wajib header X-CSRF-Token = nilai cookie csrf_token.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('access_token')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}
