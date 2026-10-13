import { expect, type Page } from '@playwright/test';
import path from 'node:path';

export const SHOTS = path.resolve(__dirname, '../docs/screenshots');

export async function login(page: Page, who: 'admin' | 'pm' | 'finance' | 'direktur' | 'investor') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@indotek.test`);
  await page.getByLabel('Password').fill('Indotek123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/rekap/);
}

export async function logout(page: Page) {
  await page.evaluate(() => localStorage.clear());
}
