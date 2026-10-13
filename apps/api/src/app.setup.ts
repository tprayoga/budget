import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

/** Konfigurasi bersama untuk main.ts dan test e2e. */
export function setupApp(app: INestApplication) {
  app.use(cookieParser());
  // foto nota base64 dari webhook bisa beberapa MB
  (app as NestExpressApplication).useBodyParser('json', { limit: '12mb' });
  // di belakang nginx: pakai X-Forwarded-For untuk IP klien (rate limit login)
  (app as NestExpressApplication).set('trust proxy', 1);
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
