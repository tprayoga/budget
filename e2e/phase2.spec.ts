import { expect, test } from '@playwright/test';
import path from 'node:path';
import { SHOTS, login, logout } from './helpers';

const RAB = path.resolve(__dirname, '../docs/samples/RAB_Project_TELCO_-_IBK_1.sample.xlsx');
const NOTA = path.join(__dirname, 'fixtures/nota.png');

test.describe.configure({ mode: 'serial' });

async function openCluster(page: import('@playwright/test').Page, name: string, tab: 'realisasi' | 'termin') {
  await page.goto('/rekap');
  await page.getByRole('link', { name, exact: true }).click();
  await page.getByRole('tab', { name: tab === 'realisasi' ? 'Realisasi' : 'Termin Klien' }).click();
}

test('Finance: import RAB (pemetaan manual OPS) & buku kas lewat UI', async ({ page }) => {
  await login(page, 'finance');
  await page.goto('/import');
  await page.getByRole('tab', { name: 'RAB Realisasi' }).click();
  await page.getByLabel('File RAB').setInputFiles(RAB);
  await page.getByRole('button', { name: /Preview/ }).click();
  // aturan default + keputusan 2.2: semua terpetakan; 2 ditahan, 3 duplikat, 3 dilewati
  await expect(page.getByRole('button', { name: 'Ditahan: 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplikat: 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Perlu dipetakan: 0' })).toBeVisible();
  await expect(page.getByTestId('rab-group').filter({ hasText: 'Cluster Sinagar & Kersanegara Tasik' })).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'import-rab.png') });
  await page.getByRole('button', { name: /^Commit/ }).click();
  await expect(page.getByText(/Import selesai: \d+ realisasi baru, 0 diperbarui, 2 ditahan/)).toBeVisible({ timeout: 30_000 });

  // daftar ditahan: C58 (????), J31 (permit Semarang), SND Kalawiran (pendapatan)
  const held = page.getByTestId('held-item');
  await expect(held).toHaveCount(3);
  await expect(held.filter({ hasText: 'SND Kalawiran' })).toContainText('Pendapatan / PO — bukan biaya');
  const item = held.filter({ hasText: 'Manado Sulut' });
  await item.getByRole('button', { name: 'Tindak lanjut' }).click();
  await item.getByLabel('Catatan item ditahan').fill('Bukan biaya proyek');
  await item.getByRole('button', { name: 'Lewati' }).click();
  await expect(page.getByTestId('held-item')).toHaveCount(2);
  // duplikat & dilewati bisa dilihat dan dibatalkan
  await page.getByRole('tab', { name: 'Duplikat & dilewati' }).click();
  await expect(page.getByTestId('held-item').filter({ hasText: 'Material FTTH CI Ngawi' })).toContainText('Duplikat');
  await expect(page.getByTestId('held-item').filter({ hasText: 'Material FTTH CI Ngawi' }).getByRole('button', { name: 'Batalkan' })).toBeVisible();

  await page.getByRole('tab', { name: 'Buku Kas' }).click();
  await page.getByLabel('File buku kas').setInputFiles(RAB);
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: /Import 290 baris baru/ }).click();
  await expect(page.getByText('290 baris diimpor')).toBeVisible();
});

test('Tab Realisasi cluster: Sinagar SUBCON 45.637.060, OPS rata 3.578.533', async ({ page }) => {
  await login(page, 'direktur');
  await openCluster(page, 'Cluster Sinagar Tasik', 'realisasi');
  const pos = (label: string) => page.locator('tr[data-level]', { hasText: label });
  await expect(pos('Biaya Subcon')).toContainText('45.637.060');
  await expect(pos('Operational Kantor')).toContainText('3.578.533');
  await expect(pos('Biaya Permit')).toContainText('37.000.000');
  await page.screenshot({ path: path.join(SHOTS, 'cluster-realisasi.png'), fullPage: true });
});

test('Termin klien: bayar kurang dari bruto → potongan jadi realisasi PAJAK', async ({ page }) => {
  await login(page, 'finance');
  await openCluster(page, 'Cluster Kersanagara RW 04 Tasik', 'termin');
  await page.getByRole('button', { name: 'Ubah termin IMPLEMENTASI 1' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tanggal invoice').fill('2026-09-16');
  await dialog.getByLabel('Tanggal dibayar').fill('2026-10-10');
  await dialog.getByLabel('Nominal diterima').fill('8.000.000');
  await expect(dialog.getByText(/akan dicatat sebagai realisasi PAJAK/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Simpan' }).click();
  const row = page.getByRole('row', { name: /Impl\. 1/ });
  await expect(row).toContainText('Dibayar');
  await expect(row).toContainText('16 Oktober 2026'); // jatuh tempo 30 hari kalender
  await page.screenshot({ path: path.join(SHOTS, 'termin-klien.png') });
  // hitung ulang termin: nilai PO belum berubah → tidak ada perubahan
  await page.getByRole('button', { name: 'Hitung ulang termin' }).click();
  await expect(page.getByTestId('recalc-IMPLEMENTASI')).toBeVisible();
  await expect(page.getByText('Tidak ada perubahan — termin sudah sesuai nilai PO.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Batal' }).click();
  await page.getByRole('tab', { name: 'Realisasi' }).click();
  await expect(page.locator('tr[data-level]', { hasText: /^Pajak/ })).toContainText('326.278'); // bruto 8.326.277,60 − diterima 8.000.000 (dibulatkan)
});

test.describe('HP: input cepat PM → verifikasi Finance', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('input cepat dengan foto nota, lalu diverifikasi Finance', async ({ page }) => {
    await login(page, 'pm');
    await page.goto('/realisasi/cepat');
    await page.getByLabel('Cari cluster').fill('Gempol');
    await page.getByRole('button', { name: /Gempol Cirebon/ }).click();
    await page.getByRole('button', { name: 'OPS teknisi' }).click();
    await page.getByLabel('Nominal').fill('150000');
    await page.getByLabel('Keterangan').fill('Makan tim lapangan e2e');
    await page.getByLabel('Foto nota').setInputFiles(NOTA);
    await page.screenshot({ path: path.join(SHOTS, 'mobile-input-cepat.png') });
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByText('Menunggu verifikasi Finance sebelum dihitung.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await logout(page);
    await login(page, 'finance');
    await page.getByRole('button', { name: 'Buka menu' }).click();
    await expect(page.getByTestId('badge-realisasi').last()).toBeVisible();
    await page.getByRole('link', { name: /Realisasi/ }).last().click();
    const item = page.getByRole('row', { name: /Makan tim lapangan e2e/ });
    await expect(item).toContainText('Perlu verifikasi');
    await expect(item.getByRole('button', { name: 'Lihat nota' })).toBeVisible();
    await item.getByRole('button', { name: /Verifikasi/ }).click();
    await expect(page.getByRole('row', { name: /Makan tim lapangan e2e/ })).toHaveCount(0);
  });
});

test('Buku kas & rekonsiliasi per bulan', async ({ page }) => {
  await login(page, 'finance');
  await page.goto('/buku-kas');
  await page.getByLabel('Project').selectOption({ label: 'EVANTAMA — PT Evantama Network System' });
  await expect(page.getByRole('row', { name: /^Juli 2026/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /^TOTAL/ }).first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'buku-kas.png') });
});
