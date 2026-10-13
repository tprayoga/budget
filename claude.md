# CLAUDE.md — Indotek Project Budget System

## Konteks bisnis

PT Indotek Buana Karya (system integrator, Bandung) mengerjakan proyek FTTH sebagai subkontraktor
untuk beberapa pemberi kerja: PT ADW, PT Evantama Network System, CCSI (dan akan bertambah).
Satu "project" (per pemberi kerja) berisi banyak "cluster/site". Modal kerja tiap cluster didanai investor.
Sistem ini menggantikan Excel manual untuk: (1) proyeksi budget per cluster, (2) form pengajuan dana
ke investor + approval, (3) realisasi biaya vs budget, (4) dashboard & laporan.

Bahasa UI: Bahasa Indonesia. Mata uang: IDR, format `Rp 1.234.567` (pemisah ribuan titik).
Tanggal: `13 Oktober 2026`. Timezone: Asia/Jakarta.

## Tech stack (WAJIB, jangan diganti)

- Monorepo pnpm + Turborepo: `apps/api`, `apps/web`, `packages/shared`
- Backend: NestJS 10 + Prisma + PostgreSQL 16
- Frontend: React 18 + Vite + TypeScript + Tailwind CSS + TanStack Query + TanStack Table + React Hook Form + Zod
- Kalkulasi bisnis: `packages/shared/src/calc/` — pure TypeScript, dipakai API & web (single source of truth)
- Uang: simpan sebagai `Decimal(18,2)` di DB; di TS gunakan `decimal.js`. JANGAN pakai float untuk uang.
- Auth: JWT (access + refresh), password bcrypt
- PDF: Puppeteer/Playwright render HTML → PDF (A4 portrait)
- Excel import/export: `exceljs`
- Test: Vitest (shared & web), Jest (api), Playwright e2e
- Docker Compose untuk dev (postgres + api + web)

## Aturan kerja

- Sebelum menulis kode di setiap fase: tampilkan rencana (struktur folder, model data, daftar endpoint & halaman,
  urutan langkah) dan TUNGGU persetujuan saya.
- Pakai daftar todo untuk melacak langkah dalam fase, centang saat selesai.
- Kerjakan per fase. Di akhir fase: jalankan semua test, lint, typecheck; tulis ringkasan di `docs/CHANGELOG.md`
  dan daftar "Yang perlu direview" lalu BERHENTI. Jangan lanjut ke fase berikutnya tanpa instruksi.
- Semua rumus kalkulasi WAJIB punya unit test dengan angka acuan di `docs/ACCEPTANCE.md`.
- Jangan hardcode persentase biaya di kode; semua dari DB (dengan default template).
- Setiap perubahan angka budget/pengajuan tercatat di audit log (siapa, kapan, nilai lama → baru).
- Commit kecil dan deskriptif. Tidak ada secret di repo; pakai `.env.example`.
