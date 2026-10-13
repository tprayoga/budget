import { execSync } from 'node:child_process';
import path from 'node:path';
import { loadTestEnv } from './env';

/** Reset database test: migrasi ulang dari nol lalu seed (termasuk import file contoh). */
export default async function globalSetup() {
  loadTestEnv();
  const cwd = path.resolve(__dirname, '..');
  const env = { ...process.env };
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd, env, stdio: 'pipe' });
  execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd, env, stdio: 'pipe' });
}
