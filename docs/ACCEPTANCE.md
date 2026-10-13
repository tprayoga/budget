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
