# Changelog

## Perbaikan — Wizard Pengajuan Dana memperhitungkan realisasi yang sudah ada (14 Oktober 2026)

### Masalah

Sisa budget di pengajuan hanya dikurangi pengajuan sebelumnya. Realisasi terverifikasi yang tidak lewat pengajuan (mis. hasil import RAB) diabaikan. Contohnya Karondoran: semua pos tampil "Sudah cair = 0" dan default diajukan 100% budget (45.404.206), sehingga investor diminta mendanai biaya yang sudah dibayar.

### Status verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test shared | 132 lulus (baru: acuan T) |
| Test API | 95 lulus (baru: Karondoran, draft lama, terminOffset, tautan expense ke pengajuan) |
| Test web | 9 lulus |
| Playwright e2e | 16 lulus (baru: wizard Karondoran) |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | bersih |
| DB Docker | migrasi `20261014200000_fr_realisasi_tanpa_pengajuan` terpasang |

### Perubahan

1. **`realisasiTanpaPengajuan`** per cluster per pos = Σ alokasi expense TERVERIFIKASI tanpa `fundRequestId`.
2. **Rumus sisa** (`shared/calc/fundRequest.ts`):
   - `sisaTersedia = ROUND(budget) − sudahDicairkan − sedangDiproses − realisasiTanpaPengajuan`.
   - `sisaSetelahPengajuan = sisaTersedia − diajukan`.
   - Validasi submit & approve ≥ 0. Override ADMIN tetap.
   - Pos yang sudah over tetapi tidak diajukan (diajukan 0) tidak memblokir pengajuan; tanpa ini setiap cluster yang punya satu pos over tidak bisa mengajukan sama sekali.
3. **Wizard langkah 2**
   - Kolom **Realisasi di luar pengajuan**, ditautkan ke daftar realisasi yang sudah difilter cluster + pos + tanpa pengajuan.
   - % default = sisa/budget (dibulatkan ke bawah 0,01%); diajukan memakai aturan pelunasan bila mencapai sisa.
   - Pos habis: input nonaktif, badge **Habis** / **Over Rp x**.
   - Tombol **Sisa budget / 50% dari sisa / 0%**.
   - Ringkasan **Budget total / Sudah terealisasi / Sisa yang bisa diajukan**.
4. **Form & PDF pengajuan**
   - Kolom **Sudah Terpakai/Dicairkan** = sudahDicairkan + realisasiTanpaPengajuan.
   - Catatan kaki "termasuk realisasi sebelum sistem (Rp x)".
   - Nilai dibekukan di snapshot saat submit (`FundRequestLine.realisasiTanpaPengajuan`).
5. **Expense yang ditautkan ke pengajuan DICAIRKAN** otomatis keluar dari realisasi tanpa pengajuan (dites).
6. **`Cluster.terminOffset`**
   - Termin sebelum sistem, hanya ADMIN (403 untuk role lain), dengan field di detail cluster.
   - terminKe = DICAIRKAN + offset + 1.
7. **Draft yang sudah ada** dihitung ulang saat dibuka bila realisasinya berubah.
   - % pos yang melebihi sisa diturunkan (pos habis → 0).
   - Muncul banner "Angka diperbarui karena realisasi sebelumnya (Rp x di luar pengajuan)" di wizard & detail.
   - Perubahan diaudit dengan pelaku sistem. Banner hilang saat submit.
8. Kartu "Sisa budget per pos" di detail cluster ikut mengurangi realisasi di luar pengajuan (kolom "Real. lain").
9. Script read-only `scripts/report-sisa-pengajuan.ts`.

### Laporan (DB Docker)

| Cluster | Budget total | Realisasi tanpa pengajuan | Sisa yang bisa diajukan | Pos habis / over |
|---|---|---|---|---|
| CCSI Kalawiran | 57.712.947 | 44.208.306 | 17.316.362 | Permit habis; Tiket over 1.509.642, OPS over 311.204, Motor over 454.709, Marketing over 1.536.168 |
| CCSI Karondoran | 45.404.206 | 37.947.460 | **12.099.279** (sebelumnya default 45.404.206) | Permit & Allowance habis; Tiket over 1.597.758, OPS over 963.495, Motor over 895.291, HB over 110.145, Marketing over 1.075.845 |
| CCSI Padangsari (Semarang) | 68.249.398 | 46.257.932 | 22.191.466 | Permit habis; Allowance over 200.000 |
| EVANTAMA Sinagar | 128.468.016 | 99.990.593 | 40.073.610 | Permit & OPS habis; Allowance over 11.596.186 |
| EVANTAMA Kersanagara RW 08 | 39.878.109 | 25.112.843 | 14.765.265 | Permit & OPS habis |
| EVANTAMA Kersanagara RW 04 | 39.666.511 | 16.072.182 | 23.594.329 | Permit & OPS habis |

### Yang perlu direview

1. **DRAFT-HO2ZQ4 tidak ada di DB Docker** (tidak ada draft terbuka). Bila ada di lingkungan lain, draft itu otomatis dihitung ulang saat dibuka.
2. **Pos over tidak menutup sisa pos lain.** Contoh Kalawiran: sisa total 17,3 jt lebih besar dari budget − realisasi (13,5 jt), karena pos yang over dianggap 0 dan tidak mengurangi pos lain. Kalau seharusnya over di satu pos memotong pos lain (realokasi), perlu aturan baru.
3. **Pos dengan sisa receh (< Rp 1) dianggap habis.** Ini muncul dari pembulatan alokasi, mis. Permit Karondoran sisa Rp 0,29.
4. **Pelaku audit hitung ulang draft = sistem.** Perubahan terjadi saat draft dibuka (GET), bukan oleh aksi user.
5. **Dua perubahan data Fase 2.4 masih menunggu persetujuan:** generate ulang termin ADW dan penerapan 4 referensi EVANTAMA yang cocok.

## Fase 2.4 — PPN termin klien, koreksi termin 1, notifikasi per lintasan, margin permit PERMIT (14 Oktober 2026)

### Status verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test shared | 127 lulus (baru: acuan Q PPN Sinagar, pencocokan, margin permit Kalawiran) |
| Test API (Jest + PostgreSQL) | 91 lulus (baru: acuan Q via API, acuan R koreksi termin 1, notifikasi lintasan & ringkasan harian) |
| Test web | 9 lulus |
| Playwright e2e | 15 lulus |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | bersih |
| DB Docker | migrasi + patch `2.4-ppn-notifikasi-tepas` terpasang; retensiAsCost = false (diaudit); **item ditahan = 0** |

### Keputusan yang diterapkan

1. **retensiAsCost = false di DB Docker.**
   - Diubah lewat `SettingsService.updateGlobal`, jalur yang sama dengan `PUT /settings/global`, memakai script `scripts/set-global-setting.ts`.
   - AuditLog mencatat `retensiAsCost true → false` dengan `alasan = "keputusan user Fase 2.3"`. Pelakunya tercatat sebagai sistem karena dijalankan operator.
   - `PUT /settings/global` sekarang menerima `reason` opsional yang ikut dicatat di audit.
2. **PPN pada termin klien.**
   - Field baru:
     - `ClientPayment.amount = DPP`.
     - `ppnRate`: default dari `Setting.ppnRate` 0,11, bisa diubah di Pengaturan.
     - `pphRate`: default = pajakRate cluster.
   - Nilai yang diturunkan: PPN, tagihan (DPP + PPN), PPh, net diharapkan (DPP + PPN − PPh).
   - PAJAK otomatis = DPP + PPN − diterima.
   - PPN tidak dihitung sebagai pendapatan maupun biaya. PPN ditampilkan sebagai "PPN keluaran (titipan)" di tab Termin Klien, di realisasi cluster, dan di kolom Rekap per project.
   - Usulan "cocok" muncul bila net referensi = net diharapkan (± Rp 10). Usulan dikonfirmasi FINANCE per baris (**Konfirmasi**) atau lewat **Terapkan semua yang cocok**.
   - Referensi Paid tanpa jatuh tempo → status Dibayar dengan badge "tanggal diterima belum diisi". Termin ini juga dihitung di inbox FINANCE.
3. **Addwork/Deduction mengoreksi termin 1.**
   - PO ADDWORK/DEDUCTION tidak punya termin sendiri. Termin 1 PO implementasi utama = template% × PO dasar + Σ koreksi.
   - Termin 1 yang sudah ditagih/dibayar tidak diubah. Koreksi masuk ke termin UNBILLED berikutnya dengan peringatan.
   - "Hitung ulang termin" menampilkan diff, termasuk termin terpisah lama yang akan **dihapus**.
4. **TEPAS RW 05 NGAWI-REV.** PO dasar tetap 33.655.100. Cluster punya field baru **`note`** (tampil dan bisa diedit di detail cluster), berisi "PO 33.655.100 dikonfirmasi user 14 Okt 2026; nilai 33.650.100 di kolom Realisasi sheet tidak dipakai". Perubahan tercatat di AuditLog. Tidak ada flag "perlu cek".
5. **Notifikasi over budget.**
   - TOTAL cluster ≥ ambang → notifikasi langsung, sekali per lintasan (tabel `OverrunState`).
   - Pos > ambang → **Ringkasan harian**: 1 notifikasi per user per hari, pos baru ditambahkan.
   - 62 notifikasi lama dibersihkan, lalu dipindai ulang (hasil di bawah).
6. **Margin permit hanya PO PERMIT** (`Cluster.permitPoAmount`). SND tetap di nilaiProyek. Kalawiran: −1.081.510,92 (sebelumnya +3.182.648).
7. Perilaku import "Sama" untuk PO dasar/total disetujui — tidak berubah.

### Hasil di DB Docker

**Notifikasi setelah pindai ulang: 4** (sebelumnya 62)

- 2 × "Over budget: Subfeeder - TEPAS RW 05 NGAWI" untuk PM & Direktur. Total realisasi 105,9% (Rp 9.100.948 / Rp 8.594.920).
- 2 × "Ringkasan harian over budget 14 Oktober 2026 — 30 pos" untuk PM & Direktur.

**Referensi tagihan RAB yang cocok otomatis (usulan, belum diterapkan)**

| Project | Referensi | Cocok | Tidak cocok |
|---|---|---|---|
| ADW | 0 | 0 | 0 |
| EVANTAMA | 8 | **4** (permit: Sinagar termin 1 Paid & 2 Unpaid, Kersanagara RW 08 termin 1 & 2 Unpaid) | 4 (implementasi) |
| CCSI | 4 | **0** | 4 |

**Rekap (retensi = piutang, interest 10%, PPN 11%)**

| Project | Nilai proyek | Profit proyeksi | Profit realisasi sekarang | Profit realisasi bila semua yang cocok diterapkan | Margin permit | PPN titipan sekarang → setelah diterapkan |
|---|---|---|---|---|---|---|
| ADW | 712.513.400 | 67.702.754 | −375.453.286 | −375.453.286 | 0 | 0 → 0 |
| EVANTAMA | 236.454.823 | 7.640.924 | −141.175.619 | **−123.165.869** (DPP 18.500.000 − PAJAK 490.250) | −6.451.500 | 0 → **2.035.000** |
| CCSI | 198.835.655 | 10.332.449 | −128.413.698 | −128.413.698 | **−6.870.920** | 0 → 0 |

- Dari referensi yang cocok, hanya Sinagar permit termin 1 yang Paid. Tiga lainnya Unpaid sehingga hanya berstatus Ditagih (tidak memengaruhi profit).
- Profit realisasi masih negatif karena hampir belum ada pembayaran klien yang tercatat.

**Preview generate ulang termin ADW (belum diterapkan, menunggu persetujuan)**

Termin 1 dikoreksi di 6 cluster dan 8 termin terpisah dihapus. Termin 2 & 3 tidak berubah, dan semua termin masih UNBILLED (tidak ada peringatan). Angka termin 1 ada di ACCEPTANCE bagian R.

### Yang perlu direview

1. **Persetujuan untuk 2 perubahan data di DB Docker.** Keduanya sudah di-preview tetapi sengaja belum diterapkan, sesuai aturan "dry-run + preview → tunggu persetujuan".
   - (a) Generate ulang termin 6 cluster ADW (diff di atas).
   - (b) Terapkan 4 referensi EVANTAMA yang cocok. Sinagar permit termin 1 Paid tidak punya tanggal diterima di RAB: isi tanggalnya, atau biarkan kosong dengan tanda?
2. **Referensi implementasi EVANTAMA tidak cocok karena PO implementasi masih digabung.** Info cluster memuat dua PO: "PO Cluster … PO Subfeeder …". RAB menagih keduanya terpisah, dan net-nya pas dengan 20% × PO masing-masing:
   - Sinagar: 18.425.090 / 1,0835 ≈ 17.005.159 → PO cluster ≈ 85.025.796.
   - Sinagar subfeeder: 5.182.355 → PO ≈ 23.914.881.
   - Jumlah keduanya ≈ PO gabungan 108.940.677. Kersanagara RW 08 polanya sama (5.819.864 + 1.739.229).
   - Perlu dipecah jadi 2 PO IMPLEMENTASI per cluster dengan nilai dari dokumen PO? Setelah dipecah, termin & referensi akan cocok.
3. **Referensi CCSI (INV-RAA/001–004) tidak cocok.** Nilainya sama dengan DPP/PO (mis. 10.212.800 = PO permit Kalawiran), tanpa PPN dan PPh. Apakah invoice CCSI memang tanpa PPN, atau kolom RAB CCSI berisi DPP? Bila tanpa PPN, ppnRate termin CCSI perlu diset 0 (bisa per termin).
4. **Ringkasan harian berisi 30 pos.** Sebagian besar pos Allowance ADW (alokasi PJD per tanggal implementasi) dan pos kecil CCSI Manado. Ringkasan ini dikirim sekali per lintasan, tidak berulang setiap hari.
5. **PPh default = pajakRate cluster** (ADW 2,5%, Evantama 2,65%, CCSI 2,5%). Termin lama juga diisi pajakRate cluster lewat migrasi.
6. **Redis tetap ditunda ke fase deployment.**

## Fase 2.3 — PO per cluster, margin permit, retensi = piutang, proteksi import, notifikasi (14 Oktober 2026)

### Status verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test shared | 123 lulus (baru: PO turunan, margin permit, acuan default 961.865,20, penyesuaian PO ADW) |
| Test API (Jest + PostgreSQL) | 87 lulus (baru: `phase23.e2e-spec.ts`) |
| Test web | 9 lulus |
| Playwright e2e | 14 lulus |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | bersih |
| DB Docker | patch 2.3 terpasang; import RAB ulang 0 baru / 0 berubah; 8 PO penyesuaian ADW; **item ditahan = 0** |

### Keputusan yang diterapkan

Patch data sekali jalan **`2.3-po-permit-semarang-fee-marketing`** (DataPatch, dipanggil dari seed, semua perubahan diaudit). Angka acuan di ACCEPTANCE bagian P.

1. **Margin permit** per cluster = nilaiPoPermit − permitCost − pajak atas permit − interest atas permitCost. Tampil di ringkasan cluster, grid project, dan kolom Rekap (merah bila negatif). Rumus pajak/interest utama tidak berubah.
2. **Permit Semarang** → diganti keputusan 9 (lihat bawah).
3. **Model `ClusterPo`** (IMPLEMENTASI / PERMIT / SND / ADDWORK / DEDUCTION, no. & tanggal PO, nilai, biaya pass-through, catatan).
   - nilaiPoImpl, nilaiPoPermit, permitCost sekarang **diturunkan** dari PO dan read-only di form/grid (PATCH langsung → 400).
   - Migrasi: setiap cluster mendapat PO IMPLEMENTASI (+ PERMIT bila ada) dari nilai lama; nomor PO diambil dari info cluster; termin lama dikaitkan ke PO-nya.
   - SND Kalawiran: PO SND FTTHSWI-5-280926 Rp 4.373.496 (pass-through 0), termin SND 1 × 100% Unpaid (Ditagih, INV-RAA/003/IX/2026). Item ditahan → RELEASED.
   - ADW "Deduction Termin 1 + Addwork": import dry-run → commit, 8 PO (tanda dari rumus baris total).
   - Termin klien digenerate **per PO**: IMPLEMENTASI/PERMIT dari template client; SND/ADDWORK/DEDUCTION 1 × 100% manual.
4. **Tanggal invoice tidak pernah ditebak.** Termin yang sudah ditagih / punya no. invoice / manual tanpa tanggal mendapat badge "tanggal invoice belum diisi" di tab Termin Klien. Termin tersebut juga dihitung di inbox FINANCE (badge kuning + daftar).
5. **Default resmi `retensiAsCost = false`** di seed dan `GLOBAL_DEFAULTS` (instalasi baru). Acuan A–F tetap dites dengan `true` eksplisit. Acuan baru: WANASARI RW 01 profit **961.865,20**.
6. **Referensi tagihan RAB** disimpan saat import RAB dan tampil di tab Termin Klien. Tombol **"Terapkan ke termin…"**: FINANCE memilih termin dan mengisi bruto; paidAmount = net referensi; potongan otomatis menjadi expense PAJAK. Tidak ada penerapan otomatis.
7. **Proteksi import budget.**
   - Field cluster/baris budget yang diedit di aplikasi (termasuk lewat tabel PO) ditandai `FieldOverride` (siapa/kapan).
   - Import Excel melewati field tersebut. Preview menampilkannya sebagai "dilindungi — diedit di aplikasi" (status cluster **Dilindungi**).
   - Field bisa ditimpa per field lewat checkbox, khusus ADMIN, dengan alasan wajib (tercatat di audit; tanda dilepas).
8. **Over budget.**
   - Notifikasi in-app untuk PM & DIREKTUR saat pos/cluster melewati `Setting.realisasiOverPct` (default 100%).
   - Satu notifikasi per pos; dilepas bila kembali di bawah ambang.
   - Lonceng notifikasi di header; daftar "Cluster over budget" di Rekap.
9. **Permit Semarang pass-through.**
   - PO PERMIT Rp 36.000.000, pass-through Rp 36.000.000, catatan "konfirmasi user 14 Okt 2026".
   - J31 dilepas → realisasi PERMIT 100% Padangsari.
   - Termin permit manual 1 × 100% UNBILLED, tanggal invoice kosong (badge).
10. **CCSI C58 "Wenda Manado Sulut" Rp 4.000.000 = fee marketing.**
    - Kategori baru **MARKETING_FEE** → pos MARKETING (CategoryMapping).
    - Dialokasikan PRO_RATA_PO ke Kalawiran & Karondoran, catatan "fee marketing — konfirmasi user 14 Okt 2026".

### Yang dibuat

- **Migrasi `20261014090000_phase23_po_override_notif`:**
  - enum PoKind; TerminKind + SND/ADDWORK/DEDUCTION; ExpenseCategory + MARKETING_FEE.
  - Tabel ClusterPo, FieldOverride, Notification, ClientInvoiceRef.
  - ClientPayment.poId/fromTemplate; unique `[poId, termin]`; `Setting.realisasiOverPct`.
- **Shared:** `derivePoTotals`, `poAmountError`, `parsePoNumbers`, `calcPermitMargin` (+ `marginPermit` di DTO/total), `parsePoAdjustments` (parser RAB), skema Zod PO & terapkan referensi.
- **API:**
  - `GET/POST /clusters/:id/pos`, `PATCH/DELETE /clusters/pos/:poId` (ADMIN/PM).
  - `POST /client-payments/:id/apply-reference` (ADMIN/FINANCE).
  - `POST /import/po-adjustments-xlsx` (dry-run/commit; ADMIN/PM).
  - `POST /import/budget-xlsx` field `force` + `reason` (ADMIN).
  - `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /inbox/missing-invoice-dates`.
  - Rekap: `overBudget`.
- **Web:**
  - Tabel PO di detail cluster.
  - Tab Termin Klien dikelompokkan per PO, dengan badge, referensi RAB, dan dialog terapkan.
  - Lonceng notifikasi, bagian inbox FINANCE, kolom margin permit & daftar over budget di Rekap.
  - Status "Dilindungi" + checkbox Timpa di import budget, tab import **Penyesuaian PO**, dan ambang notifikasi di Pengaturan.
- **Script** `scripts/import-rab.ts --po-adjustments`: preview + commit penyesuaian PO, tabel margin permit, daftar over budget, jumlah item ditahan.

### Laporan Rekap ulang (DB Docker, default baru: retensi = piutang, interest 10%)

| Project | Nilai proyek | Profit proyeksi | Margin | Pembayaran klien PAID (bruto) | Realisasi biaya | Profit realisasi | Margin permit |
|---|---|---|---|---|---|---|---|
| ADW | 712.513.400 | **67.702.754** | 9,50% | 0 | 375.453.286 | −375.453.286 | 0 |
| EVANTAMA | 236.454.823 | **7.640.924** | 3,23% | 0 | 141.175.619 | −141.175.619 | **−6.451.500** |
| CCSI | 198.835.655 | **10.332.449** | 5,20% | 0 | 128.413.698 | −128.413.698 | **−2.606.761** |

- ADW turun dari 716.165.700 karena 8 PO penyesuaian (Σ −3.652.300). CCSI naik karena SND 4.373.496 dan permit Semarang 36.000.000.
- Realisasi CCSI naik 40.000.000 (J31 permit Semarang 36.000.000 + C58 fee marketing 4.000.000).
- Profit realisasi masih negatif karena belum ada termin klien berstatus Dibayar di DB.
- Pembanding dengan retensiAsCost = true: ADW −10.673.720, EVANTAMA −12.759.106, CCSI −4.635.620.

**Margin permit per cluster:**

| Cluster | PO permit | Biaya permit | Margin permit |
|---|---|---|---|
| Sinagar Tasik | 37.000.000 | 37.000.000 | −4.680.500 |
| Kersanagara RW 08 | 9.000.000 | 9.000.000 | −1.138.500 |
| Kersanagara RW 04 | 5.000.000 | 5.000.000 | −632.500 |
| Kalawiran (Manado) | 14.586.296 (permit + SND) | 10.035.446 | +3.182.648 |
| Karondoran (Manado) | 12.176.000 | 11.964.554 | −1.289.409 |
| **Padangsari RW 12 & 13 (Semarang)** | **36.000.000** | **36.000.000** | **−4.500.000** |

**Jumlah item ditahan: 0.** Duplikat/dilewati tetap 6 (ADW C78/C79/C80, EVANTAMA G145/G147/G148), semuanya bisa dibatalkan.

### Yang perlu direview

1. **Setting retensi di DB Docker masih `true`.** Admin mengubahnya ke false pada 13 Okt 17:51 UTC, lalu kembali ke true pada 17:54 UTC. Default baru hanya berlaku untuk instalasi baru, dan setting yang dibuat user tidak saya ubah; laporan di atas memakai preview false. Perlu diubah ke false di Docker/produksi?
2. **TEPAS RW 05 NGAWI-REV:** nilai PO implementasi cluster 33.655.100 (kolom Implementation), sedangkan kolom Realisasi sheet ADW 33.650.100. Setelah penyesuaian hasilnya 33.322.600 vs AL11 33.317.600 (selisih 5.000). PO dasar mana yang benar?
3. **Termin ADDWORK/DEDUCTION ADW dibuat sebagai termin 1 × 100% terpisah** (8 termin, termasuk deduction bernilai negatif). Akibatnya inbox FINANCE berisi 12 termin tanpa tanggal invoice: 6 deduction, 2 addwork, 3 permit, 1 SND. Bila deduction seharusnya memotong termin 1 implementasi, perlu aturan lain.
4. **Referensi tagihan RAB tidak cocok dengan termin template.** Contoh: Sinagar permit I2628-00139 net 20.044.750 > termin permit 1 bruto 18.500.000 (50% × 37 jt); Sinagar impl I2628-00142 net 18.425.090 vs termin 1 21.788.135. Belum ada yang diterapkan. 6 dari 12 referensi berlaku di tingkat project (blok RAB tidak cocok dengan satu cluster).
5. **Notifikasi over budget awal: 31 pos → 62 notifikasi** (PM + DIREKTUR). Sebagian besar pos Allowance ADW (alokasi PJD per tanggal implementasi) dan pos kecil CCSI Manado (tiket, OPS, motor, marketing termasuk fee C58). Perlu ambang lain, atau notifikasi hanya untuk total cluster?
6. **Margin permit Kalawiran positif (+3.182.648)** karena SND 4.373.496 ikut nilaiPoPermit dengan pass-through 0, sesuai rumus. Konfirmasi SND memang dihitung di margin permit.
7. **Pembanding import budget** menerima nilai PO dasar (file asli) **atau** total turunan termasuk addwork/SND (file hasil export). Dengan begitu round-trip export → import tetap "Sama".
8. **Redis ditunda ke fase deployment.** Rate limit login dan pemindaian over budget masih in-process (cocok untuk 1 instance API).
9. Info pendukung di snapshot pengajuan (infoBunga/infoProfit) mengikuti setting efektif. Test FPD sekarang memakai default (770.816,80 / 961.865,20). Acuan A dengan retensi = biaya dites di kalkulasi budget.

## Fase 2.2 — Keputusan review import & penyelesaian pemetaan (14 Oktober 2026)

### Status verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test shared | 111 lulus |
| Test API (Jest + PostgreSQL) | 73 lulus |
| Test web | 9 lulus |
| Playwright e2e | 11 lulus |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | bersih |
| Import RAB di DB Docker | 18 item baru + 1 dilepas dari daftar ditahan; **0 item perlu dipetakan**; import ulang 0 dibuat / 0 diperbarui |

### Keputusan yang diterapkan

Semua keputusan disimpan sebagai `ImportMappingRule` lewat patch data sekali jalan **`2.2-keputusan-import`** (tabel baru `DataPatch`, dipanggil dari seed sehingga berlaku sama di DB test, dev, dan Docker). Semua perubahan tercatat di AuditLog. Rincian dan angka ada di ACCEPTANCE bagian O.

1. **ADW C79 → Duplikat** dengan catatan yang diminta. Bisa dibatalkan lewat tombol **Batalkan** di tab "Duplikat & dilewati": item kembali ke daftar ditahan, dan aturannya menjadi HOLD.
2. **ADW C81 → SUBCON_MATERIAL**, pro-rata nilaiPoImpl ke 2 cluster Mangunsari Tegalsari Barat Pemalang.
3. **CCSI D36 Allowance → pos Allowance**, pro-rata nilaiPoImpl Kalawiran & Karondoran. Aturan EQUAL hanya untuk tiket/HB/motor/kasbon/OPS.
4. **Permit CCSI Manado**
   - Budget: Kalawiran nilaiPoPermit 10.212.800, Karondoran 12.176.000; permitCost = 10.035.446,29 / 11.964.553,71. Tercatat di audit dengan alasan "permit pass-through dari sheet CCSI".
   - Realisasi D31 22.000.000 → PERMIT, MANUAL pro-rata 10.212.800 : 12.176.000 (sisa pembulatan ke Karondoran).
   - Termin klien PERMIT dibuat manual: 1 termin 100% per cluster, status **Ditagih** (sheet: Unpaid; invoice INV-RAA/001 & 002/IX/2026, tanggal invoice belum diketahui).
   - **SND Kalawiran 4.373.496** masuk daftar ditahan sebagai item **Pendapatan/PO** (bukan biaya), dengan catatan "PO SND terpisah, belum masuk budget". Item ini tidak bisa dilepas sebagai realisasi biaya.
5. **Pemetaan sisa**
   - **PJD Evantama (10 item, 13.775.000)** → Cluster Sinagar Tasik, pos Allowance.
   - **ADW "Biaya OPS":**
     - "Alloawance CJ Ngawi" → pro-rata 5 cluster TEPAS NGAWI.
     - 3 item PJD → pro-rata ke cluster yang **tanggal implementasinya ≤ tanggal expense** (kosong ikut). Penerimanya: C67 (25/05) 10 cluster, C68 (17/06) 10 cluster, C70 (13/08) 19 cluster. Daftar penerima tampil di preview.
   - **Site Semarang** → Padangsari RW 12 & 13 (Semarang). **Biaya Permit 36.000.000 ditahan** dengan catatan yang diminta.

### Yang dibuat

- **`Cluster.implementationDate`:** diisi dari info cluster ("Implementasi : dd/mm/yyyy") oleh patch dan saat import budget, serta bisa diubah di form cluster. Fungsi `parseImplementationDate` ada di shared (dites).
- **Aturan import `clusterFilter = IMPL_DATE_LE_EXPENSE`:** penerima ditentukan per item sesuai tanggalnya, sehingga dialokasikan per item.
- **Sinkronisasi daftar keputusan saat commit import:**
  - item ditahan → HELD;
  - duplikat/dilewati → DISMISSED (data disimpan, bisa dibatalkan);
  - item yang aturannya berubah dari ditahan menjadi terpetakan → RELEASED otomatis.
- **API & web:**
  - API: `POST /import/held/:id/reopen`, `GET /import/held?status=DISMISSED`. Item `kind = REVENUE` ditolak saat dilepas (409).
  - Web: tab "Ditahan — perlu konfirmasi" | "Duplikat & dilewati" dengan tombol Batalkan; label item pendapatan; daftar cluster penerima di preview import.
- **Label kategori PJD** menjadi "PJD / Allowance kunjungan".
- **Script import** dapat menampilkan rekap profit proyeksi vs realisasi dan daftar final item ditahan. Ada opsi `--retensi-as-cost=true|false` untuk preview proyeksi tanpa menyimpan.

### Hasil import RAB (DB Docker)

| Project | Total realisasi terverifikasi | Terimpor | Dilewati | Ditahan | Duplikat | Perlu dipetakan |
|---|---|---|---|---|---|---|
| EVANTAMA | Rp 141.175.619 | 34 | 3 (Rp 4.320.000) | 0 | 0 | 0 |
| ADW | Rp 375.453.286 | 102 | 0 | 0 | 3 (Rp 27.052.100) | 0 |
| CCSI | Rp 88.413.698 | 14 | 0 | 2 (Rp 40.000.000) | 0 | 0 |

Cluster dengan % terpakai tertinggi (realisasi terverifikasi / total budget pos):

- **ADW:**
  1. Subfeeder TEPAS RW 05 Ngawi **105,7% (lewat budget)**
  2. Pulling Distribusi Mangunsari Pemalang 99,7%
  3. Subfeeder TEPAS RW 07 Ngawi 99,1%
  4. Distribusi TEPAS RW 05 Ngawi-REV 98,0%
  5. Distribusi Kel Karangmulyo 94,3%
- **EVANTAMA:**
  1. Sinagar 77,8%
  2. Kersanagara RW 08 63,0%
  3. Kersanagara RW 04 40,5%
- **CCSI:**
  1. Karondoran 79,9%
  2. Kalawiran 72,7%
  3. Padangsari (Semarang) 32,7%

**Profit proyeksi vs profit realisasi**

Asumsi acuan: interest 10%, retensiAsCost = true.

| Project | Nilai proyek | Profit proyeksi | Margin | Pembayaran klien PAID (bruto) | Realisasi biaya | Profit realisasi |
|---|---|---|---|---|---|---|
| EVANTAMA | 236.454.823 | −12.759.106 | −5,40% | 0 | 141.175.619 | −141.175.619 |
| ADW | 716.165.700 | −7.815.037 | −1,09% | 0 | 375.453.286 | −375.453.286 |
| CCSI | 158.462.159 | −4.298.845 | −2,71% | 0 | 88.413.698 | −88.413.698 |

- Profit realisasi negatif karena di DB Docker belum ada pembayaran klien berstatus PAID. Pembayaran klien diinput di tab Termin Klien, dan tagihan di file RAB hanya ditampilkan sebagai referensi.
- **Catatan setting:** di DB Docker, setting global `retensiAsCost` saat ini **false**. Audit log mencatat perubahan oleh admin@indotek.test pada 13 Okt 2026 17:51 UTC lewat aplikasi; nilai ini **tidak saya ubah**. Dengan setting tersebut, profit proyeksi menjadi EVANTAMA 7.640.924, ADW 70.963.190, dan CCSI 10.669.224. Tabel di atas memakai asumsi acuan sebagai preview, tanpa disimpan.

**Daftar final item ditahan**

| Sel | Item | Nominal | Catatan |
|---|---|---|---|
| CCSI!C58 | "… Manado Sulut" | 4.000.000 | Bertanda "????", tidak dipakai rumus mana pun |
| CCSI!F32 | SND Kalawiran (pendapatan/PO) | 4.373.496 | PO SND terpisah, belum masuk budget |
| CCSI!J31 | Biaya Permit Semarang | 36.000.000 | Pendapatan permit Semarang belum tercatat — cek apakah pass-through |

Duplikat/dilewati (bisa dibatalkan): ADW C78, C79, C80 (Rp 27.052.100) dan EVANTAMA G145, G147, G148 (Rp 4.320.000).

### Dampak yang perlu diketahui

- **Permit pass-through tidak netral terhadap profit proyeksi.** Dengan rumus sekarang, permit menambah nilaiProyek (+22.388.800), tetapi juga menambah pajak (2,5% × nilai proyek = 559.720) dan interest (10% × dana investor tambahan = 2.255.972). Akibatnya profit proyeksi CCSI turun **2.426.892** (−1.871.953 → −4.298.845). Test API acuan C untuk CCSI saya sesuaikan; acuan C di level parser (file Excel) tidak berubah.
- **Import ulang file Budget Excel** sekarang menandai 2 cluster Manado CHANGED (permit di file = 0). Commit import budget untuk cluster itu akan mengembalikan permit ke 0, jadi jangan dipilih saat commit.

### Yang perlu direview

- [ ] **Subfeeder TEPAS RW 05 Ngawi sudah 105,7% dari budget**, dan 3 cluster Ngawi/Pemalang lain di atas 98%. Ini terjadi setelah alokasi allowance dan PJD.
- [ ] **Permit pass-through vs profit:** perlu diputuskan apakah permit pass-through dikecualikan dari dasar pajak dan interest (perubahan rumus). Saat ini rumus mengikuti spesifikasi Fase 1.
- [ ] **CCSI!J31 Permit Semarang 36.000.000:** pass-through? Bila ya, nilai PO permit Semarang belum ada di budget.
- [ ] **SND Kalawiran 4.373.496:** perlu ditambahkan sebagai nilai PO terpisah? Saat ini belum ada field "PO SND" di cluster.
- [ ] **Termin permit CCSI:** tanggal invoice INV-RAA/001 & 002 belum diketahui (status Ditagih tanpa tanggal, sehingga jatuh tempo kosong).
- [ ] **Redis ditunda ke fase deployment:** rate limit masih di memori proses, jadi API harus single instance.

## Fase 2.1 — Aturan import default, daftar ditahan, hitung ulang termin (14 Oktober 2026)

### Status verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test shared | 108 lulus |
| Test API (Jest + PostgreSQL) | 70 lulus (+4: aturan default, ditahan/lepas/lewati, MANUAL %, hitung ulang termin) |
| Test web | 9 lulus |
| Playwright e2e | 11 lulus (import RAB sekali jalan, lewati item ditahan dari UI, dialog hitung ulang termin) |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | bersih |
| Import RAB end-to-end di DB Docker | 132 realisasi dibuat, 4 ditahan; import ulang tanpa perubahan |

### Keputusan review Fase 2 (diterapkan)

- Disetujui tanpa perubahan: pembulatan kumulatif, tagihan klien RAB sebagai referensi, tanggal "Week" → tanggal 1 + label, dan expense hasil import langsung terverifikasi.
- Mapping manual dijadikan **aturan default** `ImportMappingRule` (seed insert-only, cluster dicari berdasarkan nama). Ada 22 aturan; detailnya di ACCEPTANCE bagian N.

### Hasil cek duplikat ADW baris 78–81

| Sel | Item | Hasil cek | Status |
|---|---|---|---|
| C78 | Pembelian Material Tepas Ngawi 4.275.000 (10/08) | Tidak ada di Total Material ADW. Tetapi tanggal & nominal sama persis dengan buku kas **"Pembelian Material Kersanegara RW 08 Tasikmalaya" (EVANTAMA)**, dan nominal itu sudah masuk `EVANTAMA!M42 = 91000+4275000` (Total Material Kersanagara RW 08). | **Duplikat** (lintas project) |
| C79 | Material FTTH CI Ngawi 18.386.500 | Tidak ada sebagai item tunggal. Lima sel "Material Ngawi" (Y38, AC38, AG38, AK38, AO38) berisi angka hardcode berjumlah **20.814.181,21**, mendekati pro-rata 18.386.500 + "Tmbhn Material Tepas Ngawi" 2.425.000 = 20.811.500 (selisih 2.681,21). | **Ditahan** — kemungkinan besar duplikat. Bila diimpor, material Ngawi terhitung ±18,4 juta dua kali. |
| C80 | Material Cluster Wonosobo 4.390.600 | **= BI38 2.959.400 + BM37 1.431.200**, yaitu item material di Total Material 2 cluster GUNUNGTAWANG WONOSOBO. | **Duplikat** |
| C81 | Material FTTH 4.971.400 (22/08) | Tidak cocok dengan item atau kombinasi material mana pun. Buku kas mencatatnya sebagai "Material FTTH (DS & SF Desa Mangunsari **Pemalang**)". | **Ditahan** (sesuai instruksi) |

Dari empat item, hanya C79 yang menyimpang dari instruksi awal Anda. Instruksinya: bila bukan duplikat, impor PRO_RATA ke 5 cluster Ngawi. C79 saya tahan karena buktinya kuat sebagai duplikat walau angkanya tidak sama persis. Bila Anda pastikan bukan duplikat, lepas dari daftar ditahan (usulan tujuan sudah terisi: kategori SUBCON_MATERIAL).

### Hasil import RAB end-to-end (DB Docker, aturan default, tanpa keputusan tambahan)

| Project | Total realisasi terverifikasi | Terimpor | Dilewati | Ditahan | Duplikat | Masih perlu dipetakan |
|---|---|---|---|---|---|---|
| EVANTAMA | Rp 127.400.619 | 24 | 3 (Rp 4.320.000) | 0 | 0 | 10 — daftar Biaya PJD (Rp 13.775.000) |
| ADW | Rp 352.011.886 | 97 | 0 | 2 (Rp 23.357.900) | 2 (Rp 8.665.600) | 4 — "Biaya OPS" berisi PJD/Allowance (Rp 18.470.000) |
| CCSI | Rp 56.155.766 | 11 | 0 | 2 (Rp 26.000.000) | 0 | 3 — Site Semarang (Rp 46.257.932) |

Cluster dengan % terpakai tertinggi (realisasi terverifikasi / total budget pos):

- **EVANTAMA** (hanya 3 cluster):
  1. Sinagar 67,1% (86.215.593 / 128.468.016)
  2. Kersanagara RW 08 63,0%
  3. Kersanagara RW 04 40,5%
- **ADW:**
  1. Distribusi Kel Karangmulyo **94,3%**
  2. Subfeeder TEPAS RW 05 Ngawi 90,7%
  3. Pulling Distribusi Mangunsari Pemalang 87,5%
  4. Subfeeder TEPAS RW 07 Ngawi 84,3%
  5. Distribusi TEPAS RW 05 Ngawi-REV 82,6%
- **CCSI** (hanya 3 cluster):
  1. Karondoran (Manado) 74,9%
  2. Kalawiran (Manado) 66,2%
  3. Padangsari (Semarang) 0% (blok Semarang belum dipetakan)

Data Docker sekarang berisi realisasi hasil import ini.

### Yang dibuat

- **(a) Hitung ulang termin**
  - Endpoint: `GET /clusters/:id/client-payments/recalculate` (preview diff) dan `POST` (terapkan; ADMIN/FINANCE).
  - Aturan: termin INVOICED/PAID tidak berubah, termin UNBILLED dihitung dari persentase template, dan **termin UNBILLED terakhir menampung selisih** sehingga Σ termin = Σpct × nilai PO terkini. Termin template yang belum ada dibuat.
  - Bila semua termin sudah ditagih, atau nilai PO baru lebih kecil dari yang sudah ditagih → error.
  - UI: tombol "Hitung ulang termin" di tab Termin Klien, membuka dialog konfirmasi berisi diff sebelum → sesudah. Semua perubahan tercatat di audit.
- **(b) Alokasi MANUAL di form pemetaan import:** persentase per cluster (Σ harus 100%), dialokasikan kumulatif. Disimpan di aturan (`manualPcts`).
- **(c) Daftar "Ditahan — perlu konfirmasi"**
  - Keputusan baru `HOLD` dan `DUPLICATE` (selain `SKIP`), ditambah catatan.
  - Item ditahan disimpan di tabel `ImportHeldItem` beserta datanya. Item bisa **dilepas** (pilih kategori + tujuan, termasuk MANUAL %) atau ditandai lewati/duplikat **tanpa import ulang**.
  - Pelepasan memperbarui aturan, sehingga import berikutnya UNCHANGED.
  - Preview import menampilkan status Ditahan/Duplikat/Dilewati beserta catatannya.
- **Catatan expense:** kolom `Expense.note` (mis. kasbon "kasbon — perlu penyelesaian"), ditampilkan di daftar realisasi.
- **Script CLI** `apps/api/scripts/import-rab.ts` (dry-run/commit + laporan per project).

### Asumsi

1. **CCSI D36 "Allowance Doc SND & Mob Demob" (5.551.950)** saya anggap sebagai "biaya operasional site" dan dibagi **EQUAL** sesuai instruksi (2.775.975 per cluster), dengan kategori PJD sehingga masuk pos **Allowance**. Catatan: di Excel baris Allowance (E22/G22) dihitung **pro-rata** (6% × nilai implementasi: 3.265.193,76 / 2.286.757,92), bukan /2.
2. **CCSI D31 Biaya Permit Site Manado 22.000.000** tidak disebut dalam keputusan, jadi saya **tahan** dengan catatan.
3. **OPS Evantama** (grup "Cluster Sinagar & Kersanegara Tasik") ikut dijadikan aturan default EQUAL 3 cluster, sesuai keputusan Fase 2 (acuan J).
4. **Seed aturan bersifat insert-only:** keputusan yang sudah diubah pengguna tidak ditimpa. Aturan dilewati bila cluster dengan nama terkait belum ada (mis. DB production tanpa data contoh).

### Yang perlu direview

- [ ] **ADW C79 (18.386.500):** konfirmasi duplikat atau bukan (lihat tabel cek duplikat).
- [ ] **CCSI D36 Allowance:** EQUAL (sesuai instruksi) atau pro-rata (sesuai rumus Excel E22)?
- [ ] **CCSI D31 Permit Manado 22.000.000:** metode alokasi ke 2 cluster.
- [ ] **Item yang masih perlu dipetakan:**
  - daftar Biaya PJD Evantama (10 item, 13.775.000; rata 3 cluster?),
  - "Biaya OPS" ADW berisi PJD/Allowance (4 item, 18.470.000; cluster mana?),
  - blok CCSI Site Semarang (permit 36.000.000, jasa 7.445.482, allowance 2.812.450). Hanya ada 1 cluster Semarang; boleh dipetakan otomatis ke cluster tsb?
- [ ] **Redis ditunda ke fase deployment:** rate limit login & webhook masih di memori proses (single instance). Wajib diganti Redis bila API dijalankan lebih dari satu instance.

## Fase 2 — Realisasi biaya vs budget (14 Oktober 2026)

### Status verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test shared (Vitest), termasuk acceptance G–M dan parser RAB pada file sanitasi | 107 lulus |
| Test API (Jest + PostgreSQL), termasuk import RAB → realisasi, alokasi, PAJAK otomatis, webhook, tautan pengajuan, rekonsiliasi, RBAC | 66 lulus (+28) |
| Test web (Vitest) | 9 lulus |
| Playwright e2e (Fase 1 + Fase 2, desktop & HP) | 11 lulus |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | bersih |
| `docker compose up --build`, termasuk profile `https` (Caddy TLS internal) | berjalan |

### Keputusan yang diterapkan

1. **Mapping kategori → pos:**
   - SUBCON_JASA, SUBCON_MATERIAL, MATERIAL_PEMBELIAN → SUBCON; PERMIT → PERMIT; **OPS → OPS_KANTOR**; PJD → ALLOWANCE; TICKET/HOMEBASE/MOTOR_MOBIL → pos bernama sama; kategori baru **PAJAK → PAJAK**; LAINNYA dipilih manual.
   - Mapping disimpan di DB dan bisa diubah ADMIN.
2. **Status input:** input PM (termasuk input cepat HP) dan kiriman webhook = PERLU_VERIFIKASI. Input FINANCE/ADMIN langsung TERVERIFIKASI. Verifikasi/tolak hanya oleh FINANCE.
3. **Alokasi:** `PRO_RATA_PO` memakai bobot nilaiPoImpl (tanpa permit). Item import RAB level project diusulkan EQUAL.
4. **Gempol:**
   - Kategori mengikuti label item ("Term 1 Material" → SUBCON_MATERIAL), dengan peringatan "label ≠ formula total".
   - Label ambigu ("Term 1 Jasa & Material 30%" di Wingkoharjo) mengikuti formula total, juga dengan peringatan.
   - Item OPS/PJD yang labelnya bertentangan dengan section masuk daftar manual.
5. **ClientPayment** menyimpan nilai bruto (`amount`) dan nilai diterima (`paidAmount`).
   - Status PAID dengan paidAmount < amount → expense PAJAK otomatis (TERVERIFIKASI, source CLIENT_PAYMENT, sourceRef = id payment). Expense ini terkunci dari edit/hapus manual dan ikut berubah atau terhapus saat pembayaran diedit.
   - Profit realisasi = Σ bruto termin PAID − Σ realisasi terverifikasi.
   - "Kas diterima" ditampilkan terpisah.
6. **Hari kerja:** Senin–Jumat + tabel `HariLibur` (CRUD oleh ADMIN, seed kosong). Jatuh tempo hari kerja melewati hari libur.
7. **Template termin:** ADW 80/10/10 tanpa aging. CCSI tanpa template (termin manual).
8. **Buku kas:** hanya referensi. Ada halaman rekonsiliasi per project per bulan (Σ cash out vs Σ expense terverifikasi + selisih, tanpa auto-match).

### Yang dibuat

**Kalkulasi & parser (`packages/shared`)**

- **`allocateGroup` / `allocate`:** EQUAL, PRO_RATA_PO, MANUAL.
  - Pembulatan dilakukan secara **kumulatif**: 12 item OPS yang dialokasikan per item tetap menghasilkan 3.578.533,33 / ,33 / ,34 per cluster, dan setiap item tetap utuh.
- **Kalkulasi lain:** `calcRealization` (level kuning/merah dari `Setting.realisasiWarnPct`), `calcRealizedProfit`, `paymentDeduction`, `calcFundUsage`, `generateTermins` (sisa pembulatan ke termin terakhir), `calcDueDate` / `addWorkingDays`.
- **Parser RAB (`@indotek/shared/xlsx`):**
  - Mencari sel "Total Jasa / Material / Permit / Total / Total Lain-lain", lalu **mengikuti referensi formulanya**, termasuk shared formula dan total bertingkat (`=D54` → D53).
  - Membaca section "Biaya OPS", "Biaya PJD", dan daftar "Keterangan".
  - Membaca tagihan klien ("Term N - I2628-…", "INV-…").
  - Membaca buku kas TELCO - OPS dari nilai cache IMPORTRANGE.
  - **Verifikasi kelengkapan:** ke-71 total di sheet ADW/EVANTAMA/CCSI sama persis dengan Σ item hasil parse.
- **Skema Zod** expense, termin, template, webhook, dan keputusan import.

**Model data (migrasi `phase2_realisasi`)**

- `Expense` (status, source, `sourceRef` untuk idempotensi, alokasi, tautan ke `FundRequest`, foto nota), `ExpenseAllocation`, `CategoryMapping`.
- `TerminTemplate` + `TerminTemplateLine`, `ClientPayment`, `HariLibur`.
- `CashLedger`, `ApiKey`, `ImportMappingRule`, dan `Setting.realisasiWarnPct`.
- Seed (insert-only) mengisi mapping default, template termin, ambang 80%, dan backfill termin untuk 36 cluster (108 termin).

**API**

- **Expense:**
  - `/expenses`: CRUD, menerima JSON atau multipart dengan foto.
  - Verifikasi/tolak oleh FINANCE. PM yang mengubah expense DITOLAK → kembali menunggu verifikasi.
  - Tautan ke pengajuan, dengan syarat pengajuan **DICAIRKAN** dan cluster-nya termasuk alokasi.
  - Endpoint `pending-count` untuk badge Finance.
- **Realisasi:** `GET /clusters/:id/realization`, `/projects/:id/realization`, `/projects/:id/reconciliation`. Rekap kini memuat ringkasan realisasi per cluster.
- **Termin klien:**
  - Termin dibuat otomatis saat cluster dibuat.
  - Endpoint: `PATCH /client-payments/:id` (jatuh tempo otomatis + sinkron PAJAK), termin manual, dan `generate?recalculate=true` (hitung ulang termin UNBILLED).
  - Hapus cluster ditolak bila sudah ada realisasi atau tagihan.
- **Pengaturan:** `category-mappings`, `termin-templates`, `holidays` (ADMIN). Semua tercatat di AuditLog.
- **Pengajuan dana:**
  - `GET /fund-requests/:id/realization` (dana cair vs realisasi vs sisa di tangan) dan `/realization-report.pdf`.
  - `POST /fund-requests/:id/attachments/previous-report`: membuat lampiran "Laporan realisasi termin sebelumnya" otomatis dari pengajuan DICAIRKAN terakhir di cluster yang sama.
- **Webhook:**
  - `POST /webhooks/expenses`, dengan `X-API-Key` tersimpan sebagai hash (SHA-256) dan ditampilkan sekali saat dibuat.
  - Rate limit 60/menit per key. Idempoten lewat `externalId`.
  - Foto via multipart atau base64 (dicek signature JPEG/PNG/WebP); tidak mengambil foto dari URL.
  - Cluster harus id atau nama persis (bila ambigu: 422 + daftar kandidat). Hasil selalu PERLU_VERIFIKASI.
- **Import:**
  - `POST /import/rab-xlsx?mode=dry-run|commit`: status NEW/CHANGED/UNCHANGED/NEEDS_MAPPING/SKIPPED, peringatan, total sheet, dan tagihan klien.
  - Keputusan per grup/blok, atau per item dengan `scope: INHERIT` (hanya kategori), disimpan sebagai aturan.
  - Expense hasil import langsung TERVERIFIKASI.
  - `POST /import/cash-ledger-xlsx` bersifat idempotent (hash per baris). `GET /import/cash-ledger`.

**Web**

- **Cluster:** tab **Budget | Realisasi | Termin Klien**.
  - Realisasi: kartu pembayaran bruto / kas diterima / realisasi / profit realisasi / menunggu verifikasi, tabel per pos (kuning > ambang, merah > 100%), dan daftar realisasi dengan porsi alokasi.
  - Termin Klien: jadwal, edit invoice/bayar, jatuh tempo, penanda terlambat, preview potongan PAJAK, dan termin manual.
- **Realisasi:** daftar + filter. Finance langsung melihat antrean "Perlu verifikasi" (badge di menu). Form lengkap mencakup alokasi project-level rata / pro-rata / manual dan foto nota yang dikompres.
- **Input cepat HP (`/realisasi/cepat`):** cluster (cari + terakhir dipakai), kategori sebagai tombol besar, nominal, tanggal, dan foto kamera yang dikompres ke JPEG ±1600 px. Tidak ada scroll horizontal (dicek di e2e).
- **Detail pengajuan:** panel dana cair vs realisasi vs sisa dana di tangan + unduh laporan PDF. Wizard termin ≥ 2 mendapat tombol "Generate laporan realisasi".
- **Import:** tab Budget | RAB Realisasi | Buku Kas, dengan form pemetaan manual per grup (tujuan cluster / project + metode, "Pakai usulan") dan kategori per item.
- **Halaman lain:** Buku Kas & Rekonsiliasi. Pengaturan: ambang kuning, mapping kategori, template termin, hari libur, API key. Rekap: kolom Realisasi & Profit realisasi.
- **Docker:** service **Caddy** opsional (`--profile https`, TLS internal, port 8443) untuk uji dari HP lewat LAN tanpa mematikan cookie Secure. `TRUST_PROXY_HOPS` bisa diatur.

### Asumsi

1. **Tanggal item OPS dari periode:** "Juli Week 2" disimpan sebagai tanggal 1 bulan itu + label periode, dengan peringatan. Item tanpa tanggal di sheet (mis. "Material Sinagar") disimpan tanpa tanggal dan masuk baris "Tanpa tanggal" di rekonsiliasi.
2. **Tagihan klien di file RAB hanya ditampilkan sebagai referensi**, tidak diterapkan otomatis ke ClientPayment. Nilai di sheet adalah nilai bersih setelah PPh dan dipisah per PO cluster/subfeeder, sehingga tidak cocok 1:1 dengan termin template. Input dilakukan di tab Termin Klien.
3. **Expense hasil import RAB** langsung TERVERIFIKASI (diverifikasi oleh user yang mengimpor; import hanya untuk ADMIN/FINANCE).
4. **Kategori webhook** harus kode atau label persis, tanpa pencocokan fuzzy. LAINNYA ditolak karena tidak punya pos default.
5. **Expense PAJAK otomatis** bertanggal sama dengan tanggal bayar dan dialokasikan 100% ke cluster termin.
6. **Template termin diubah:** termin yang sudah ada tidak ikut berubah. Hitung ulang termin UNBILLED tersedia lewat API `generate?recalculate=true` (belum ada tombolnya di UI).
7. **Profit realisasi** cluster yang belum menerima pembayaran bernilai negatif (biaya sudah keluar, pembayaran belum masuk). Ini sesuai rumus, bukan galat.
8. **Buku kas:** baris dengan label project yang bukan project sistem (RPJ, IKR, OPS FTTH, OPS BTS, PAYROLL BTS) disimpan dengan label aslinya tanpa project, sehingga tidak masuk rekonsiliasi per project.

### Yang perlu direview

- [ ] **Pemetaan manual hasil preview file contoh:**
  - "CCSI - Site Manado" (Total Jasa 36.920.416): di test dibagi rata ke 2 cluster Manado. Mohon konfirmasi apakah rata atau pro-rata.
  - Daftar CCSI "Keterangan" (tiket, HB, sewa motor, kasbon, OPS) perlu dipilih kategori dan cluster-nya. Kasbon tidak punya usulan kategori.
  - EVANTAMA sel E144:G148 berisi ringkasan PJD yang duplikat dengan daftar PJD. Sebaiknya di-**Lewati**.
  - ADW baris 78–81 (pembelian material Ngawi/Wonosobo) belum jelas cluster-nya.
  - ADW "Biaya OPS" berisi item PJD/Allowance (masuk daftar manual sesuai keputusan).
- [ ] **Pembulatan alokasi kumulatif dalam satu grup import:** porsi per item bisa berbeda ±0,01 dari pembagian item tunggal, tetapi total per cluster selalu cocok dengan Excel. Mohon dicek apakah dapat diterima oleh Finance.
- [ ] **Rate limit webhook & login masih di memori proses**, sehingga perlu Redis bila API dijalankan lebih dari satu instance.
- [ ] **Sertifikat Caddy:** dibuat oleh CA internal, sehingga HP akan menampilkan peringatan kecuali root CA dipasang (lihat README). Untuk production gunakan domain + sertifikat publik.
- [ ] **UI belum ada untuk:** hitung ulang termin saat nilai PO berubah, alokasi MANUAL pada import RAB, dan pemetaan baris buku kas ke project non-sistem.
- [ ] **Data realisasi di DB dev/Docker lokal masih kosong.** Import file RAB lewat menu Import → RAB Realisasi bila ingin mencoba dengan data contoh.

## Fase 1.1 — Hardening (13 Oktober 2026)

### Status verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test shared (Vitest; acceptance A–F, C memakai file sanitasi) | 71 lulus |
| Test API (Jest + PostgreSQL) | 38 lulus (+9 test auth/keamanan) |
| Test web (Vitest) | 8 lulus |
| Playwright e2e | 6 lulus |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | bersih |
| `docker compose up --build` | berjalan; cookie `HttpOnly; Secure; SameSite=Lax` terverifikasi |

### Keputusan review Fase 1 (diterapkan)

- Aturan pelunasan, presisi `Decimal(16,12)`, seed insert-only, dan ADMIN tanpa hak approve: disetujui tanpa perubahan.
- Setting khusus project sekarang hanya bisa diubah ADMIN & DIREKTUR (`PUT /projects/:id/settings`), dan tercatat di AuditLog. PM dan role lain hanya bisa memakai preview what-if di halaman Project (tidak disimpan).

### a. File contoh berisi data asli

- **File sanitasi:** `docs/samples/Budget_Per_Cluster_ADW_Evantama_CCSI.sample.xlsx` dan `docs/samples/RAB_Project_TELCO_-_IBK_1.sample.xlsx`. Isinya dibersihkan dari:
  - nama pemohon dan nama staf/teknisi/subcon (diganti "Staf A", "Teknisi F", …),
  - nomor rekening dan plat kendaraan,
  - ID Google Sheet di formula IMPORTRANGE,
  - semua komentar sel (berisi nama reviewer),
  - metadata penulis file.
- **Angka tidak berubah:** 6.703 sel angka dibandingkan dengan file asli, dan tidak ada yang berbeda.
- **Test & seed:** test C, test import, dan seed memakai file sanitasi.
- **Lokasi file asli:** `private/` (gitignored), bersama `private/sanitize-samples.cjs`. Script sanitasi ditaruh di sana karena berisi daftar nama asli.
- **History git ditulis ulang** dengan `git filter-repo` (path file asli dan `private/` dihapus dari semua commit). Hash commit berubah. Hasil verifikasi:
  - `git log --all -- docs/samples/` hanya menampilkan commit yang menambah file `*.sample.xlsx`.
  - `git log --all -S5225173963` dan `git grep` di semua revisi: 0 hasil.
  - Pemeriksaan seluruh objek git (180 blob, termasuk isi xlsx yang di-unzip), dicari nomor rekening, nama pemohon, dan ID sheet: 0 hasil.
  - Reflog dan objek unreachable: 0.

### b. Auth berbasis cookie

- **Lokasi token:** access token (cookie `access_token`, path `/api`) dan refresh token (cookie `refresh_token`, path `/api/auth`), keduanya `HttpOnly; Secure; SameSite=Lax`. Body respons login/refresh hanya berisi data user. Header `Authorization: Bearer` tidak lagi diterima.
- **CSRF double-submit:** cookie `csrf_token` (bisa dibaca JS) wajib dikirim ulang di header `X-CSRF-Token` untuk semua request selain GET/HEAD/OPTIONS. Dicek oleh guard global dengan `timingSafeEqual`. Pengecualian: `/auth/login`.
- **Rotasi token:** refresh token dan token CSRF dirotasi setiap kali login, refresh, dan ganti password. Logout mencabut refresh token dan menghapus cookie.
- **Web:** semua pemakaian `localStorage` untuk token dihapus. Fetch memakai cookie sesi, membaca `csrf_token` untuk header, dan otomatis refresh saat 401.

### c. Keamanan akun

- **User demo:** hanya dibuat bila `NODE_ENV != production`. Di production, seed membuat master data dan admin awal dari `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD`, tanpa cluster contoh (kecuali `SEED_SAMPLE_CLUSTERS=true`). Dites di DB terpisah.
- **Wajib ganti password:**
  - Kolom baru `User.mustChangePassword` (default true untuk user baru dan user demo).
  - Selama belum diganti, semua endpoint kecuali `/auth/me`, `/auth/change-password`, `/auth/refresh`, dan `/auth/logout` membalas 403 `PASSWORD_CHANGE_REQUIRED`. Web mengarahkan ke halaman "Ganti password".
  - Kebijakan password: minimal 10 karakter, berisi huruf dan angka, tidak boleh sama dengan password lama.
  - Ganti password mencabut semua sesi lain dan tercatat di AuditLog (tanpa nilai password).
- **Rate limit `/auth/login`:** 5 percobaan per 60 detik per IP + email (bisa diatur dengan `LOGIN_RATE_LIMIT` dan `LOGIN_RATE_WINDOW_MS`), membalas 429 dengan sisa waktu tunggu. `trust proxy` diaktifkan agar IP klien di belakang nginx terbaca benar.

### Yang perlu direview (1.1)

- [ ] **Rate limiter disimpan di memori proses.** Cukup untuk satu instance API; perlu Redis bila API dijalankan lebih dari satu instance.
- [ ] **Login via HTTP non-localhost:** cookie `Secure` mewajibkan HTTPS untuk host selain localhost. Untuk uji coba di HP lewat IP LAN, set `COOKIE_SECURE=false` sementara, atau pasang HTTPS (disarankan sebelum direktur/investor memakai dari HP).
- [ ] **Docker build cache lokal** masih bisa menyimpan layer lama berisi file asli (image lama sudah terganti). Jalankan `docker builder prune` bila perlu.
- [ ] **Repo lain yang sudah memakai history lama:** belum ada remote, jadi aman. Bila repo ini pernah disalin ke tempat lain sebelum 1.1, salinan itu masih memuat file asli.

## Fase 1 — Fondasi, Budget per Cluster, Form Pengajuan Dana (13 Oktober 2026)

### Status verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test shared (Vitest), termasuk acceptance A–F | 71 lulus |
| Test API (Jest + PostgreSQL), termasuk C & F lewat DB, RBAC, akses investor, row lock, round-trip import/export | 29 lulus |
| Test web (Vitest) | 6 lulus |
| Playwright e2e (desktop + HP) | 5 lulus |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | bersih |
| `docker compose up --build` | berjalan: web :8080, API :3000, PDF via Chromium di container |

### Yang dibuat

**Fondasi**

- Monorepo pnpm + Turborepo, Docker Compose (postgres, api, web/nginx), `.env.example`, ESLint + Prettier.
- Prisma schema dan migrasi. Model sesuai spesifikasi, ditambah model yang disetujui: `BudgetTemplate`/`BudgetTemplateLine`, `RefreshToken`, `ProjectMember`, `FpdSequence`, field snapshot dan pencairan di `FundRequest`, `Attachment.kind = BUKTI_CAIR`, serta `User.jabatan`.
- Auth JWT: access token + refresh token yang dirotasi dan bisa dicabut. Password bcrypt. Guard RBAC global.
- Audit log untuk semua perubahan angka cluster/budget line, pengajuan, setting, template, dan lampiran (nilai lama → baru, user, waktu).

**Kalkulasi (`packages/shared`)**

- `calcCluster` dan `calcProjectTotal` sesuai rumus spesifikasi, memakai `decimal.js` dengan presisi penuh.
- Form pengajuan: `computeFundRequest`, `aggregateFrHistory` (`sudahDicairkanSebelum`, `sedangDiproses`, `terminKe`), nomor FPD, label draft, dan justifikasi default.
- `terbilang` (sepuluh, sebelas, belas, seratus, seribu, juta, milyar, triliun).
- Format Rupiah, persen, dan tanggal Asia/Jakarta.
- State machine approval.
- Skema Zod yang dipakai bersama API dan web.
- Parser Excel (`@indotek/shared/xlsx`), dipakai endpoint import, seed, dan test acceptance C.

**API (`/api`, Swagger di `/api/docs`)**

- **Auth:** `login`, `refresh`, `logout`, `me`.
- **CRUD:** client, project, anggota project, cluster, dan budget line. Termasuk duplicate cluster dan template cluster baru dari DB.
- **Setting:** global hanya ADMIN, override per project oleh ADMIN/PM. Termasuk template global dan per project.
- **Budget:** `GET /projects/:id/budget` dan `GET /budget/rekap`, dengan preview what-if lewat query `interestRate` / `retensiAsCost` tanpa menyimpan.
- **Pengajuan dana:**
  - Draft dihitung live dan diberi label `DRAFT-xxxxxx`.
  - SUBMIT berjalan dalam transaksi dengan row lock pada cluster: nomor FPD diberikan per project per bulan (dari tanggal pengajuan), snapshot dibekukan, dan sisa budget divalidasi termasuk `sedangDiproses`.
  - Approve/reject per step sesuai role, dengan validasi ulang di setiap approve. Revisi DITOLAK → DRAFT memakai nomor yang sama.
  - Pencairan oleh FINANCE dengan tanggal dan bukti wajib. Override sisa budget hanya untuk ADMIN, dengan alasan.
  - Lampiran: upload, centang, hapus, dan unduh.
  - Inbox per role.
- **PDF A4:** satu halaman, meniru sheet "Form ADW". Header kuning, rincian A/B, informasi pendukung, terbilang, justifikasi, rekening, lampiran ✓, 4 kolom tanda tangan dengan nama dan tanggal approver yang terisi otomatis. Watermark DRAFT/DITOLAK.
- **Import Excel:** `POST /import/budget-xlsx` dengan mode `dry-run` (preview + diff per field) dan `commit` (semua atau cluster terpilih), dalam satu transaksi dengan audit.
- **Export Excel:**
  - Budget dengan layout sama seperti file contoh: sheet Rekap + sheet per project, dengan formula Excel. Mode % ditulis sebagai formula dan mode Rp sebagai angka, sehingga hasil export bisa di-import ulang tanpa perubahan (sudah dites).
  - Daftar pengajuan.
- **Seed:** 5 user demo, setting dan template default (pajak Evantama 2,65%), 3 client/project, dan 36 cluster dari file contoh. Investor demo hanya terdaftar di ADW.

**Web**

- Login.
- **Rekap:**
  - Ringkasan, tabel project/cluster dengan total per project, angka negatif merah.
  - Filter project/status/divisi dan pencarian.
  - Panel Asumsi: hitung ulang langsung di browser. Tombol Simpan hanya untuk ADMIN.
- **Project:** grid ala spreadsheet (TanStack Table), label dan header sticky, edit inline %/Rp, toggle mode per sel (nilai rupiah dipertahankan), kalkulasi live, simpan batch, tambah cluster, dan setting khusus project.
- **Cluster detail:** form, waterfall Nilai Proyek → Dana Investor → Interest → Profit, sisa budget per pos (cair, proses, sisa), riwayat pengajuan, dan duplikat.
- **Pengajuan Dana:**
  - Daftar dengan filter status, pencarian, dan export.
  - Wizard 4 langkah: cluster → % cair (simpan otomatis, info "sedang diproses") → lampiran → review + rekening/justifikasi → simpan draft atau ajukan.
  - Detail dengan timeline, tombol sesuai role, modal tolak/cairkan, dan unduh PDF.
- Inbox approval dengan badge, Import Excel (preview/diff/pilih/commit), Data Master (client, project, akses investor), dan Pengaturan (setting global, rekening default, template).
- Responsif. Di HP: bottom nav, daftar berupa kartu, panel aksi approve di atas, dan tanpa scroll horizontal (dicek di e2e).

### Asumsi yang diambil

1. **Penyesuaian pembulatan termin pelunasan.** Rumus `diajukan = ROUND(budget × pctCair)` dipakai apa adanya. Masalahnya, dua termin 50% bisa melebihi budget 1 rupiah. Contoh: pajak 236.021,25 → 2 × 118.011 = 236.022 > 236.021, sehingga termin kedua akan ditolak validasi. Solusinya: bila Σ pctCair pos (termin sebelumnya + sekarang) **tepat 100%**, `diajukan` = sisa yang tersedia, dengan selisih maksimal ±1 rupiah per pos dan tanda "≈ pelunasan". Angka acuan F di ACCEPTANCE.md memakai aturan ini (#1 = 3.854.083, #2 = 3.854.087, total = 7.708.170).
2. **Presisi persentase `Decimal(16,12)`** (bukan 8 desimal). Dengan 8 desimal, mengubah sel dari Rp ke % menggeser rupiah, misalnya 6.952.900 → 6.952.899,97. Ditemukan lewat unit test web.
3. **ADMIN tidak bisa approve atas nama FINANCE/DIREKTUR/INVESTOR** (pemisahan tugas). ADMIN boleh membuat/mengajukan pengajuan dan melakukan override.
4. **Override setting per project** (interest/retensi) boleh diubah ADMIN dan PM. Setting global hanya ADMIN.
5. **Pengajuan yang sudah di-override ADMIN** tidak diblokir lagi oleh validasi sisa budget saat approve.
6. **Lampiran boleh hanya dicentang tanpa file** (`fileUrl` nullable), mengikuti checklist di form Excel. Tiga lampiran default dibuat tidak tercentang.
7. **Tanda tangan di PDF** berupa cap "DISETUJUI SECARA ELEKTRONIK" + nama + tanggal dari siklus approval terakhir. Riwayat lengkap tetap ada di timeline.
8. **Rekening default seed** adalah data dummy (BCA 1234567890 a.n. PT Indotek Buana Karya). Rekening asli di file contoh tidak disalin. Rekening asli bisa diisi di menu Pengaturan.
9. **Import:**
   - Asumsi di sheet Rekap file (interest/retensi) tidak diimpor, hanya ditampilkan.
   - Cluster yang ada di DB tetapi tidak ada di file tidak dihapus, hanya ditandai "Tidak ada di file".
   - Cluster baru dari import berstatus ONGOING.
10. **Seed** hanya menambah cluster yang belum ada, agar restart container tidak menimpa editan user. Pembaruan dari Excel dilakukan lewat menu Import.
11. **Preview what-if di Rekap** mengganti nilai global. Project yang punya override sendiri tetap memakai override-nya.
12. **Inbox PM** hanya menampilkan pengajuan DITOLAK miliknya. Daftar pengajuan menampilkan semua pengajuan.

### Yang perlu direview

- [ ] **Aturan penyesuaian pembulatan termin pelunasan** (asumsi 1). Apakah ini sesuai praktik Finance, atau diinginkan aturan lain (mis. pembulatan ke bawah)?
- [ ] **Aturan approval:** ADMIN tidak bisa approve (asumsi 3), dan PM boleh mengubah setting project (asumsi 4).
- [ ] **Penyimpanan token:** access dan refresh token disimpan di `localStorage` web. Lebih aman memakai cookie httpOnly untuk refresh token bila aplikasi dibuka di internet.
- [ ] **Data sensitif di repo:** `docs/samples/*.xlsx` sudah di-commit dan berisi nama serta nomor rekening asli di sheet "Form". Perlu diputuskan apakah file ini boleh ada di repo.
- [ ] **Format file export:** formula dan layout baris sama dengan file contoh, tetapi styling (merge cell, warna persis) tidak identik. Nilai cache formula ditulis sebagai number, dan Excel menghitung ulang saat file dibuka.
- [ ] **Akurasi PDF:** sudah dicek visual (lokal & Docker), dan e2e memverifikasi respons PDF (status, tipe, ukuran). Mohon dicek terhadap form asli.
- [ ] **Data dev lama** (dibuat sebelum migrasi `rate_precision`): persentase sempat tersimpan 8 desimal. Contoh: total profit CCSI −1.871.953,56, padahal Excel −1.871.953,01. Database baru (Docker/seed/test) sudah 12 desimal dan sama persis dengan Excel. Database dev lama perlu di-reset (`prisma migrate reset`) atau import ulang file contoh.
- [ ] **Belum ada di Fase 1:** realisasi biaya, dashboard grafik, notifikasi email/WA, manajemen user di UI (hanya API `POST /users`), dan penyimpanan file ke object storage.
