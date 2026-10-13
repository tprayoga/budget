import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Muat .env root lalu arahkan DATABASE_URL ke database test. */
export function loadTestEnv() {
  const envFile = path.resolve(__dirname, '../../../.env');
  const fallback = path.resolve(__dirname, '../../../.env.example');
  const file = existsSync(envFile) ? envFile : fallback;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgresql://indotek:indotek@localhost:5432/indotek_budget_test?schema=public';
  process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
  process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
  process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'indotek-test-uploads');
  process.env.SEED_PASSWORD = 'Indotek123!';
  // supertest memakai HTTP biasa: cookie Secure tidak akan dikirim ulang
  process.env.COOKIE_SECURE = 'false';
  process.env.TZ = 'Asia/Jakarta';
}
