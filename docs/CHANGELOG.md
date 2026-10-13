# Changelog

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
