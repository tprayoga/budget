import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { setupApp, setupSwagger } from './app.setup';
import { assertProductionConfig } from './config/production-config';

async function bootstrap() {
  process.env.TZ = process.env.TZ ?? 'Asia/Jakarta';
  assertProductionConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  setupApp(app);
  // Swagger hanya di luar production (atau bila SWAGGER=true)
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER === 'true') setupSwagger(app);
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  app.get(Logger).log(`API berjalan di port ${port} (versi ${process.env.APP_VERSION ?? 'dev'})`);
}
void bootstrap();
