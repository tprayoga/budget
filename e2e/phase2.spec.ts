import { expect, test } from '@playwright/test';
import path from 'node:path';
import { SHOTS, login, logout } from './helpers';

const RAB = path.resolve(__dirname, '../docs/samples/RAB_Project_TELCO_-_IBK_1.sample.xlsx');
const NOTA = path.join(__dirname, 'fixtures/nota.png');

test.describe.configure({ mode: 'serial' });

async function openCluster(page: import('@playwright/test').Page, name: string, tab: 'realisasi' | 'termin') {
  await page.goto('/rekap');
  await page.getByRole('link', { name, exact: true }).first().click();
  await page.getByRole('tab', { name: tab === 'realisasi' ? 'Realisasi' : 'Termin Klien' }).click();
}

test('Finance: import RAB (pemetaan manual OPS) & buku kas lewat UI', async ({ page }) => {
  await login(page, 'finance');
  await page.goto('/import');
  await page.getByRole('tab', { name: 'RAB Realisasi' }).click();
  await page.getByLabel('File RAB').setInputFiles(RAB);
  await page.getByRole('button', { name: /Preview/ }).click();
  // aturan default + keputusan 2.2 & 2.3: semua terpetakan; 0 ditahan, 3 duplikat, 3 dilewati
  await expect(page.getByRole('button', { name: 'Ditahan: 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplikat: 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Perlu dipetakan: 0' })).toBeVisible();
  await expect(page.getByTestId('rab-group').filter({ hasText: 'Cluster Sinagar & Kersanegara Tasik' })).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'import-rab.png') });
  await page.getByRole('button', { name: /^Commit/ }).click();
  await expect(page.getByText(/Import selesai: \d+ realisasi baru, 0 diperbarui, 0 ditahan/)).toBeVisible({ timeout: 30_000 });

  // keputusan 2.3: daftar ditahan kosong (SND → PO, J31 → permit Semarang, C58 → fee marketing)
  await expect(page.getByTestId('held-item')).toHaveCount(0);
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
  const row = page.getByTestId('po-group-IMPLEMENTASI').getByRole('row', { name: /Termin 1/ });
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

test('PO cluster: tambah Addwork → nilai PO implementasi & termin 100% (badge tanggal invoice)', async ({ page }) => {
  await login(page, 'pm');
  await page.goto('/rekap');
  await page.getByRole('link', { name: 'WANASARI RW 02 SUBANG', exact: true }).first().click();
  const po = page.getByRole('region', { name: 'PO cluster' });
  await expect(po.getByRole('row', { name: /^Implementasi/ })).toContainText('13.949.300');
  await po.getByRole('button', { name: 'Tambah PO' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nilai PO').fill('-100');
  await dialog.getByRole('button', { name: 'Simpan' }).click();
  await expect(dialog.getByText('Nilai PO tidak boleh negatif')).toBeVisible();
  await dialog.getByLabel('Nilai PO').fill('500.000');
  await dialog.getByRole('button', { name: 'Simpan' }).click();
  await expect(po.getByRole('row', { name: /^Addwork/ })).toContainText('500.000');
  await expect(po.getByRole('row', { name: /Nilai PO Implementasi/ })).toContainText('14.449.300');
  await expect(page.getByLabel('Nilai PO Implementasi (Rp)')).toHaveValue('14.449.300');
  await page.screenshot({ path: path.join(SHOTS, 'cluster-po.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Termin Klien' }).click();
  await expect(page.getByTestId('po-group-ADDWORK')).toContainText('500.000');
  await expect(page.getByTestId('po-group-ADDWORK').getByTestId('badge-tanggal-invoice')).toBeVisible();
  // bersihkan
  await page.getByRole('tab', { name: 'Budget' }).click();
  page.once('dialog', (d) => void d.accept());
  await po.getByRole('button', { name: /Hapus PO Addwork/ }).click();
  await expect(po.getByRole('row', { name: /^Addwork/ })).toHaveCount(0);
});

test('Termin klien: badge tanggal invoice (permit Semarang), inbox FINANCE, terapkan referensi RAB', async ({ page }) => {
  await login(page, 'finance');
  await expect(page.getByTestId('inbox-missing-badge').first()).toBeVisible();
  await page.goto('/inbox');
  const missing = page.getByRole('region', { name: 'Termin tanpa tanggal invoice' });
  await expect(missing.getByRole('row', { name: /Padangsari RW 12 & 13/ })).toBeVisible();
  await expect(missing.getByRole('row', { name: /Kalawiran Kakas Barat/ })).toHaveCount(2); // permit (2.2) + SND (2.3)
  await expect(missing.getByRole('row', { name: /Kalawiran Kakas Barat.*SND/ })).toContainText('INV-RAA/003/IX/2026');
  await missing.getByRole('link', { name: 'Padangsari RW 12 & 13 (Semarang)' }).click();
  await expect(page.getByTestId('po-group-PERMIT').getByTestId('badge-tanggal-invoice')).toBeVisible();
  await expect(page.getByTestId('po-group-PERMIT')).toContainText('36.000.000');

  await openCluster(page, 'Cluster Sinagar Tasik', 'termin');
  const refs = page.getByRole('region', { name: 'Referensi tagihan RAB' });
  const ref = refs.getByRole('row', { name: /I2628-00139/ });
  await expect(ref).toContainText('20.044.750');
  await ref.getByRole('button', { name: 'Terapkan ke termin…' }).click();
  const dialog = page.getByRole('dialog');
  const target = dialog.getByLabel('Termin tujuan');
  await target.selectOption((await target.locator('option', { hasText: /PO Permit.*termin 1 / }).getAttribute('value'))!);
  await dialog.getByLabel('Nilai bruto').fill('20.500.000');
  await dialog.getByLabel('Tanggal diterima').fill('2026-09-30'); // referensi tidak punya jatuh tempo → wajib diisi
  await expect(dialog).toContainText('455.250'); // potongan → PAJAK
  await page.screenshot({ path: path.join(SHOTS, 'terapkan-referensi.png') });
  await dialog.getByRole('button', { name: 'Terapkan' }).click();
  await expect(ref).toContainText('Diterapkan');
  await expect(page.getByTestId('po-group-PERMIT').getByRole('row', { name: /Termin 1/ })).toContainText('Dibayar');
});

test('Notifikasi: lonceng tersedia untuk PM', async ({ page }) => {
  await login(page, 'pm');
  await page.goto('/rekap');
  await page.getByRole('button', { name: /^Notifikasi/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Daftar notifikasi' })).toBeVisible();
});
