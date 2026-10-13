import { expect, type Page } from '@playwright/test';
import path from 'node:path';

export const SHOTS = path.resolve(__dirname, '../docs/screenshots');
export const PASSWORD = 'Indotek123!';
export const NEW_PASSWORD = 'IndotekBaru2026';

/**
 * Login user demo. Login pertama wajib ganti password (Indotek123! → IndotekBaru2026);
 * login berikutnya memakai password baru.
 */
export async function login(page: Page, who: 'admin' | 'pm' | 'finance' | 'direktur' | 'investor') {
  const attempt = async (password: string) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(`${who}@indotek.test`);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Masuk' }).click();
    return Promise.race([
      page.getByRole('heading', { name: /Ganti password|Rekap Budget/ }).waitFor().then(() => 'ok' as const),
      page.getByText('Email atau password salah').waitFor().then(() => 'wrong' as const),
    ]);
  };
  if ((await attempt(NEW_PASSWORD)) === 'wrong') {
    expect(await attempt(PASSWORD)).toBe('ok');
  }
  if (page.url().includes('/ganti-password')) {
    await page.getByLabel('Password saat ini').fill(PASSWORD);
    await page.getByLabel('Password baru').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Simpan password' }).click();
  }
  await expect(page).toHaveURL(/\/rekap/);
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}
