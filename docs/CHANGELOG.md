# Changelog

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
