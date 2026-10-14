import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
export const E2E_DB = 'postgresql://indotek:indotek@localhost:5432/indotek_budget_e2e?schema=public';
const API_PORT = 3100;
const WEB_PORT = 5174;
/**
 * E2E_BASE_URL diisi → uji terhadap stack yang sudah berjalan (mis. stack production lokal https://localhost:8444,
 * DB baru ber-seed ALLOW_DEMO_SEED). Server dev tidak dijalankan.
 */
const EXTERNAL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  use: {
    baseURL: EXTERNAL ?? `http://localhost:${WEB_PORT}`,
    ignoreHTTPSErrors: !!EXTERNAL,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: EXTERNAL ? [] : [
    {
      // Database e2e terpisah: reset + migrasi + seed (import file contoh), lalu jalankan API
      command:
        'cd apps/api && npx prisma migrate reset --force --skip-seed --skip-generate && ' +
        'npx ts-node --transpile-only prisma/seed.ts && cd ../.. && node apps/api/dist/main.js',
      cwd: root,
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        DATABASE_URL: E2E_DB,
        API_PORT: String(API_PORT),
        JWT_ACCESS_SECRET: 'e2e-access-secret',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret',
        UPLOAD_DIR: path.join(root, 'e2e/test-results/uploads'),
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        SEED_PASSWORD: 'Indotek123!',
        TZ: 'Asia/Jakarta',
      },
    },
    {
      command: `pnpm --filter @indotek/web exec vite --port ${WEB_PORT} --strictPort`,
      cwd: root,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
