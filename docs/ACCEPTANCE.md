# Acceptance Test — Fase 1

Semua angka di bawah dijadikan unit test:

| Bagian | File test |
|---|---|
| A, B, D, F | `packages/shared/src/calc/budget.test.ts`, `packages/shared/src/calc/fundRequest.test.ts` |
| C | `packages/shared/test/acceptance-import.test.ts` (membaca file contoh asli) dan `apps/api/test/budget.e2e-spec.ts` (lewat DB setelah seed/import) |
| E | `packages/shared/src/calc/terbilang.test.ts` |
| F (alur API) | `apps/api/test/fund-request.e2e-spec.ts` |

Setting untuk semua kasus (kecuali disebut lain): **interestRate 10%**, **retensiAsCost = true**.

Pembulatan: kalkulasi memakai presisi penuh (`decimal.js`). Nilai dibulatkan HALF_UP 2 desimal hanya saat
disimpan/ditampilkan. Total project dihitung dari nilai presisi penuh per cluster, lalu dibulatkan.

## A. ADW — "WANASARI RW 01 SUBANG"

Input: nilaiPoImpl 9.440.850; nilaiPoPermit 0; permitCost 0; SUBCON mode RP 6.952.900; TICKET 0;
pajak 2,5%; retensi 10%; INDIRECT 1%; DIRECT 1,5%; OPS_KANTOR 1%; MOTOR_MOBIL 0; HOMEBASE 0;
ALLOWANCE 1%; MARKETING 1%.

| Hasil | Nilai |
|---|---|
| pajak | 236.021,25 |
| retensi | 944.085 |
| danaInvestor | 8.652.253 |
| interest | 865.225,30 |
| outflow | 9.517.478,30 |
| profit | −76.628,30 |
| margin | −0,81% |

Form pengajuan (pctCair 100% semua pos):

| Pos | Budget | Diajukan |
|---|---|---|
| Biaya Subcon | 6.952.900 | 6.952.900 |
| Biaya Permit | 0 | 0 |
| Ticket Internal | 0 | 0 |
| Pajak | 236.021,25 | 236.021 |
| **Subtotal A** | 7.188.921,25 | 7.188.921 |
| Indirect Cost | 94.408,50 | 94.409 |
| Direct Cost | 141.612,75 | 141.613 |
| Operational Kantor | 94.408,50 | 94.409 |
| Motor dan Mobil | 0 | 0 |
| Homebase | 0 | 0 |
| Allowance | 94.408,50 | 94.409 |
| Marketing | 94.408,50 | 94.409 |
| **Subtotal B** | 519.246,75 | 519.249 |
| **TOTAL** | 7.708.168 | **7.708.170** |

Terbilang TOTAL: **"Tujuh juta tujuh ratus delapan ribu seratus tujuh puluh rupiah"**.
Informasi Pendukung: bunga 865.225,30; retensi 944.085; profit −76.628,30; margin −0,81%.

## B. Cluster A dengan retensiAsCost = false

| Hasil | Nilai |
|---|---|
| danaInvestor | 7.708.168 |
| interest | 770.816,80 |
| profit | 961.865,20 |

## C. Total project setelah import file contoh (retensiAsCost = true, toleransi ±1 rupiah)

| Project | Cluster | nilaiProyek | profit |
|---|---|---|---|
| ADW | 30 | 716.165.700 | −7.815.037 |
| EVANTAMA | 3 | 236.454.823 | −12.759.106 |
| CCSI | 3 | 136.073.359 | −1.871.953 |

## D. Evantama — "Cluster Sinagar Tasik"

nilaiPoImpl 108.940.677; nilaiPoPermit 37.000.000; permitCost 37.000.000 (pct tampilan 100%);
nilaiProyek 145.940.677; pajak 2,65% × 145.940.677 = **3.867.427,94** (presisi penuh 3.867.427,9405).

## E. Terbilang

| Angka | Terbilang |
|---|---|
| 0 | Nol rupiah |
| 1.000 | Seribu rupiah |
| 11.000.011 | Sebelas juta sebelas rupiah |
| 1.250.000.000 | Satu milyar dua ratus lima puluh juta rupiah |
| 7.708.170 | Tujuh juta tujuh ratus delapan ribu seratus tujuh puluh rupiah |

## F. Pencairan bertahap 50% + 50% (cluster A)

1. Pengajuan #1, pctCair 50% semua pos → terminKe **1**, sudahDicairkanSebelum 0, TOTAL diajukan **3.854.083**.
   - Contoh pos: Pajak ROUND(118.010,625) = 118.011; Indirect ROUND(47.204,25) = 47.204; Direct ROUND(70.806,375) = 70.806.
2. Selama #1 masih berstatus DIAJUKAN … DIKETAHUI_INVESTOR, pengajuan lain untuk pos yang sama memakai
   `sedangDiproses` = diajukan #1. Pengajuan 100% ditolak validasi karena
   ROUND(budget) − sudahDicairkan − sedangDiproses − diajukan < 0.
3. #1 → DICAIRKAN. Pengajuan #2, pctCair 50% → terminKe **2**; sudahDicairkanSebelum per pos = diajukan #1
   (Subcon 3.476.450; Pajak 118.011; Indirect 47.204; Direct 70.806; Ops 47.204; Allowance 47.204; Marketing 47.204;
   total 3.854.083).
4. #2 adalah termin pelunasan (Σ pctCair = 100%), jadi diajukan = sisa yang tersedia. Penyesuaian
   pembulatan maks. ±1 rupiah per pos: Pajak 118.010; Indirect 47.205; Direct 70.807; Ops/Allowance/Marketing 47.205.
   TOTAL diajukan #2 = **3.854.087**, sisaBudget setiap pos = **0**, dan #1 + #2 = 7.708.170 (sama dengan pengajuan 100%).

---

# Acceptance Test — Fase 2 (Realisasi biaya vs budget)

| Bagian | File test |
|---|---|
| Kalkulasi (alokasi, realisasi, termin, potongan pembayaran) | `packages/shared/src/calc/realization.test.ts` |
| Parser RAB & buku kas | `packages/shared/test/acceptance-rab.test.ts` (membaca `docs/samples/RAB_Project_TELCO_-_IBK_1.sample.xlsx`) |
| Lewat API/DB (import, alokasi, webhook, pembayaran klien) | `apps/api/test/realization.e2e-spec.ts` |

Mapping kategori → pos budget (default, bisa diubah di DB):

| Kategori | Pos |
|---|---|
| SUBCON_JASA, SUBCON_MATERIAL, MATERIAL_PEMBELIAN | SUBCON |
| PERMIT | PERMIT |
| OPS | OPS_KANTOR |
| PJD | ALLOWANCE |
| TICKET / HOMEBASE / MOTOR_MOBIL | pos bernama sama |
| PAJAK | PAJAK |
| LAINNYA | dipilih manual |

## G. Evantama — "Cluster Sinagar Tasik" (sheet EVANTAMA)

Total Jasa (D44) **19.284.060**, Total Material (D45) **26.353.000**, Biaya Permit (D33) **37.000.000**.
Setelah import: realisasi pos SUBCON = 45.637.060, pos PERMIT = 37.000.000.

## H. CCSI Manado (sheet CCSI)

Total Jasa (D42) **36.920.416**. Blok "CCSI - Site Manado" mencakup 2 cluster, jadi item ini masuk daftar
"perlu dipetakan manual" (tidak ditebak).

## I. ADW — "Gempol Cirebon" (kategori ditentukan label item)

| Ukuran | Nilai |
|---|---|
| Total Jasa di sheet (D42, formula `D34+D35+D36`) | 17.682.752 |
| SUBCON_JASA (Term 1 Jasa 8.343.200 + Cut Pekerjaan 4.996.000) | **13.339.200** |
| SUBCON_MATERIAL (Term 1 Material 4.343.552 + SPK 02 Material 610.736) | **4.954.288** |
| Realisasi pos SUBCON (= sheet ADW E12) | **18.293.488** |

D35 "Term 1 Material 80%" diberi peringatan "label ≠ formula total".

## J. Biaya OPS Evantama — alokasi project-level

Total 12 item (D49:D60) = **10.735.600**.

| Metode | Sinagar | RW 08 | RW 04 |
|---|---|---|---|
| EQUAL (default import RAB) | 3.578.533,33 | 3.578.533,33 | **3.578.533,34** |
| PRO_RATA_PO (bobot nilaiPoImpl 108.940.677 / 34.882.758 / 41.631.388) | 6.306.352,74 | 2.019.291,44 | **2.409.955,82** |

Sisa pembulatan selalu masuk ke cluster terakhir. Alokasi 12 item dihitung secara kumulatif, sehingga total per
cluster tetap sama seperti mengalokasikan 10.735.600 sekaligus.

## K. Pembayaran klien → expense PAJAK otomatis

Termin bruto 10.000.000, diterima 9.735.000 (PAID) → expense PAJAK **265.000** (TERVERIFIKASI, source
CLIENT_PAYMENT, tidak bisa diedit manual). paidAmount diubah ke 9.750.000 → expense PAJAK menjadi **250.000**.
Profit realisasi = Σ bruto termin PAID − Σ realisasi terverifikasi (termasuk PAJAK). Kas diterima = Σ paidAmount.

## L. Webhook

Expense dari webhook berstatus PERLU_VERIFIKASI. Angka realisasi cluster **tidak berubah** sampai FINANCE
memverifikasinya; setelah diverifikasi, realisasi bertambah sebesar nominal expense.

## M. Termin klien & jatuh tempo

- ADW 80/10/10 (tanpa aging): 44.741.500 → 35.793.200 / 4.474.150 / 4.474.150.
- Evantama implementasi 20/30/40/10 atas nilaiPoImpl, dengan sisa pembulatan ke termin terakhir:
  108.940.677 → 21.788.135,40 / 32.682.203,10 / 43.576.270,80 / 10.894.067,70.
- Evantama permit 50/50: 37.000.000 → 18.500.000 / 18.500.000.
- Jatuh tempo 30 hari kalender: 16 Sep 2026 → 16 Okt 2026.
- Jatuh tempo 14 hari kerja: 14 Sep 2026 → 2 Okt 2026. Bila 1 Okt hari libur → 5 Okt 2026.

## N. Fase 2.1 — import RAB sekali jalan dengan aturan default

Aturan default di-seed (`apps/api/src/import/default-rab-rules.ts`, insert-only). Dites di `apps/api/test/realization.e2e-spec.ts`.

| Item | Keputusan | Hasil |
|---|---|---|
| CCSI Site Manado jasa D35, D37, D38 (36.920.416) | PRO_RATA_PO ke Kalawiran & Karondoran | Σ 2 cluster = 36.920.416 |
| CCSI Manado D36 Allowance Doc SND & Mob Demob | EQUAL 2 cluster, kategori PJD (pos Allowance) | 2.775.975 / cluster |
| CCSI Manado D31 Biaya Permit 22.000.000 | **Ditahan** (metode alokasi belum diputuskan) | — |
| CCSI daftar Keterangan (C54–C61) | EQUAL 2 cluster Manado; tiket → TICKET, HB → HOMEBASE, sewa motor → MOTOR_MOBIL, kasbon & OPS → OPS (pos OPS_KANTOR) | Tiket 1.803.700 / cluster (= E12); OPS_KANTOR 2.488.000 / cluster (= E19) |
| CCSI C58 "… Manado Sulut" 4.000.000 ("????") | **Ditahan** | tidak diimpor |
| EVANTAMA E144:G148 ringkasan PJD | Dilewati (duplikat) | status SKIPPED |
| ADW C78 Pembelian Material Tepas Ngawi 4.275.000 | **Duplikat**: tanggal & nominal sama dengan buku kas "Pembelian Material Kersanegara RW 08" (EVANTAMA) dan sudah ada di `EVANTAMA!M42 = 91000+4275000` | status DUPLICATE |
| ADW C79 Material FTTH CI Ngawi 18.386.500 | **Ditahan** — kemungkinan duplikat 5 sel "Material Ngawi" (Σ 20.814.181,21 ≈ 18.386.500 + 2.425.000) | dilepas di test → PRO_RATA 5 cluster TEPAS NGAWI, Σ = 18.386.500 |
| ADW C80 Material Cluster Wonosobo 4.390.600 | **Duplikat**: = BI38 2.959.400 + BM37 1.431.200 | status DUPLICATE |
| ADW C81 Material FTTH 4.971.400 | **Ditahan** (buku kas: Pemalang) | — |

Commit pertama tanpa keputusan tambahan: 4 item ditahan, 2 duplikat, 3 dilewati. Import ulang: NEW = 0, CHANGED = 0.

Alokasi MANUAL di pemetaan import memakai persentase per cluster (Σ = 100%, dibulatkan kumulatif). Contoh ADW
"Biaya OPS" 70% / 30%: item 10.000.000 → 7.000.000 / 3.000.000. Total selain 100% ditolak (400).

Hitung ulang termin (nilai PO Batumpang diubah ke 26.000.000, termin 1 sudah PAID): termin 1 tetap, termin 2 =
10% × 26.000.000 = 2.600.000, termin 3 = 26.000.000 − termin 1 − termin 2. Bila semua termin sudah ditagih → 409.
