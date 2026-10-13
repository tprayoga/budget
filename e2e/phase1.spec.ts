import { expect, test } from '@playwright/test';
import path from 'node:path';
import { NEW_PASSWORD, PASSWORD, SHOTS, login, logout } from './helpers';

test.describe.configure({ mode: 'serial' });

test('Login pertama wajib ganti password; sesi di cookie httpOnly, tidak ada token di localStorage', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indotek.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/ganti-password/);
  await page.goto('/rekap');
  await expect(page).toHaveURL(/\/ganti-password/);
  await page.getByLabel('Password saat ini').fill(PASSWORD);
  await page.getByLabel('Password baru').fill('pendek');
  await page.getByRole('button', { name: 'Simpan password' }).click();
  await expect(page.getByText('Minimal 10 karakter')).toBeVisible();
  await page.getByLabel('Password baru').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Simpan password' }).click();
  await expect(page).toHaveURL(/\/rekap/);

  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([]);
  const cookies = await page.context().cookies();
  const byName = Object.fromEntries(cookies.map((c) => [c.name, c]));
  expect(byName.access_token.httpOnly).toBe(true);
  expect(byName.access_token.secure).toBe(true);
  expect(byName.access_token.sameSite).toBe('Lax');
  expect(byName.refresh_token.httpOnly).toBe(true);
  expect(byName.csrf_token.httpOnly).toBe(false);
  expect(await page.evaluate(() => document.cookie)).not.toContain('access_token');
});

test('Rekap: total project, filter, preview asumsi tanpa simpan', async ({ page }) => {
  await login(page, 'pm');
  const adwTotal = page.getByRole('row', { name: /TOTAL ADW/ });
  await expect(adwTotal).toContainText('716.165.700');
  await expect(adwTotal).toContainText('-7.815.037');
  await expect(page.getByRole('row', { name: /TOTAL EVANTAMA/ })).toContainText('-12.759.106');
  await expect(page.getByRole('row', { name: /TOTAL CCSI/ })).toContainText('-1.871.953');
  await page.screenshot({ path: path.join(SHOTS, 'rekap.png'), fullPage: false });

  // Acceptance B lewat preview (PM tidak bisa menyimpan)
  const wanasari = page.getByRole('row', { name: /WANASARI RW 01 SUBANG/ });
  await expect(wanasari).toContainText('-76.628');
  await page.getByRole('switch', { name: /Retensi dihitung sebagai biaya/ }).click();
  await expect(wanasari).toContainText('961.865');
  await expect(page.getByText('Mode preview — belum disimpan.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simpan' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Batalkan preview' }).click();
  await expect(wanasari).toContainText('-76.628');

  await page.getByPlaceholder('Cari cluster / PO / SPK…').fill('sinagar');
  await expect(page.getByRole('row', { name: /Cluster Sinagar Tasik/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /WANASARI RW 01 SUBANG/ })).toHaveCount(0);
});

test('Project grid: edit inline + toggle mode, hitung live', async ({ page }) => {
  await login(page, 'pm');
  await page.getByRole('link', { name: 'TOTAL ADW' }).click();
  await expect(page.getByTestId('project-grid')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'project-grid.png') });

  // PM tidak bisa menyimpan setting project, hanya preview what-if
  await page.getByRole('button', { name: 'Coba what-if setting project' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Simpan' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Interest khusus project' }).click();
  await page.getByLabel('Interest project persen').fill('20');
  await page.getByRole('dialog').getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText(/Mode preview: interest 20,00%/)).toBeVisible();
  await page.getByRole('button', { name: 'Batalkan' }).click();

  await page.getByRole('button', { name: 'Indirect Cost Gempol Cirebon', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Indirect Cost Gempol Cirebon' });
  await input.fill('2');
  await input.press('Enter');
  await expect(page.getByText('1 cluster diubah')).toBeVisible();
  await page.getByRole('button', { name: 'Ganti mode Direct Cost Gempol Cirebon' }).click();
  await page.getByRole('button', { name: 'Batal' }).click();
  await expect(page.getByText('cluster diubah')).toHaveCount(0);
});

test('Alur pengajuan: wizard → ajukan → approve 3 tahap → cair → PDF', async ({ page }) => {
  await login(page, 'pm');
  await page.goto('/pengajuan/baru');
  await page.getByPlaceholder('Cari cluster…').fill('WANASARI RW 01');
  await page.getByRole('option', { name: /WANASARI RW 01 SUBANG/ }).click();
  await page.getByRole('button', { name: /Buat draft/ }).click();

  // Langkah 2 — % cair 100% → total 7.708.170
  await expect(page.getByRole('row', { name: /^TOTAL/ })).toContainText('7.708.170');
  await page.screenshot({ path: path.join(SHOTS, 'wizard-pct-cair.png') });
  await page.getByRole('button', { name: 'Lanjut' }).click();

  // Langkah 3 — lampiran
  await page.getByRole('checkbox', { name: /Rencana kerja/ }).check();
  await expect(page.getByRole('checkbox', { name: /Rencana kerja/ })).toBeChecked();
  await page.getByRole('button', { name: 'Lanjut' }).click();

  // Langkah 4 — review & ajukan
  await expect(page.getByText('Tujuh juta tujuh ratus delapan ribu seratus tujuh puluh rupiah')).toBeVisible();
  await page.getByRole('button', { name: 'Ajukan' }).click();
  await expect(page.getByRole('heading', { name: /FPD\/ADW\/\d{4}\/\d{2}\/001/ })).toBeVisible();
  const url = page.url();

  for (const who of ['finance', 'direktur', 'investor'] as const) {
    await logout(page);
    await login(page, who);
    await expect(page.getByTestId('inbox-badge').first()).toHaveText('1');
    await page.goto(url);
    await page.getByRole('button', { name: /Periksa|Setujui|Mengetahui/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.getByText('Diketahui Investor').first()).toBeVisible();

  await logout(page);
  await login(page, 'finance');
  await page.goto(url);
  await page.getByRole('button', { name: 'Tandai Dicairkan' }).click();
  await page.getByLabel('Bukti transfer').setInputFiles(path.join(__dirname, 'fixtures/bukti.pdf'));
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click();
  await expect(page.getByText(/Dana dicairkan tanggal/)).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'pengajuan-detail.png'), fullPage: true });

  const pdfResponse = page.waitForResponse((r) => r.url().endsWith('/pdf'));
  await page.getByRole('button', { name: 'Unduh PDF' }).click();
  const res = await pdfResponse;
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  // isi biner (%PDF) diverifikasi di test API; di sini cukup ukuran respons
  expect(Number(res.headers()['content-length'])).toBeGreaterThan(10_000);
});

test('Investor hanya melihat project ADW', async ({ page }) => {
  await login(page, 'investor');
  await expect(page.getByRole('row', { name: /TOTAL ADW/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /TOTAL EVANTAMA/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /TOTAL CCSI/ })).toHaveCount(0);
});

test.describe('HP (direktur approve dari ponsel)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('pengajuan baru muncul di inbox direktur & bisa disetujui', async ({ page }) => {
    // PM ajukan pengajuan 50% untuk cluster lain, Finance periksa
    await login(page, 'pm');
    await page.goto('/pengajuan/baru');
    await page.getByPlaceholder('Cari cluster…').fill('Gempol');
    await page.getByRole('option', { name: /Gempol Cirebon/ }).click();
    await page.getByRole('button', { name: /Buat draft/ }).click();
    await page.getByRole('button', { name: '50%' }).click();
    await expect(page.getByText('Tersimpan otomatis')).toBeVisible();
    await page.getByRole('button', { name: 'Lanjut' }).click();
    await page.getByRole('button', { name: 'Lanjut' }).click();
    await page.getByRole('button', { name: 'Ajukan' }).click();
    await expect(page.getByRole('heading', { name: /FPD\/ADW/ })).toBeVisible();
    const url = page.url();
    await logout(page);
    await login(page, 'finance');
    await page.goto(url);
    await page.getByRole('button', { name: /Periksa/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await logout(page);
    await login(page, 'direktur');
    await page.getByRole('link', { name: /Inbox/ }).first().click();
    await page.getByRole('link', { name: /FPD\/ADW/ }).first().click();
    await page.screenshot({ path: path.join(SHOTS, 'mobile-approval.png') });
    // tidak ada scroll horizontal di HP
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: /Setujui \(Direktur\)/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
    await expect(page.getByText('Disetujui Direktur').first()).toBeVisible();

    await page.goto('/rekap');
    await expect(page.getByRole('row', { name: /TOTAL ADW/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, 'mobile-rekap.png') });
  });
});
