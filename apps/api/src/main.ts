import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp, setupSwagger } from './app.setup';

async function bootstrap() {
  process.env.TZ = process.env.TZ ?? 'Asia/Jakarta';
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  setupSwagger(app);
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  console.log(`API berjalan di http://localhost:${port}/api — Swagger: /api/docs`);
}
void bootstrap();
