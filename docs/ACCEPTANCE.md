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

Diperbarui Fase 2.4 (PPN, lihat bagian Q): termin DPP 10.000.000 + PPN 11% 1.100.000 = tagihan 11.100.000,
diterima 10.835.000 (PAID) → expense PAJAK **265.000** (TERVERIFIKASI, source CLIENT_PAYMENT, tidak bisa diedit
manual). paidAmount diubah ke 10.850.000 → expense PAJAK menjadi **250.000**. Profit realisasi = Σ DPP termin PAID −
Σ realisasi terverifikasi (termasuk PAJAK). Kas diterima = Σ paidAmount (10.850.000); PPN titipan 1.100.000.

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

## O. Fase 2.2 — keputusan review import (patch `2.2-keputusan-import`)

Dites di `apps/api/test/realization.e2e-spec.ts` dan `budget.e2e-spec.ts`.

| Keputusan | Hasil yang dites |
|---|---|
| ADW C79 → duplikat (bisa dibatalkan) | status DUPLICATE + catatan; "Batalkan" → HELD; diputuskan lagi → DUPLICATE |
| ADW C81 → SUBCON_MATERIAL pro-rata 2 cluster Mangunsari Pemalang | Σ alokasi 4.971.400 ke 2 cluster |
| CCSI D36 Allowance 5.551.950 → pos Allowance, pro-rata nilaiPoImpl | Satu grup kumulatif dengan jasa Manado (D35, D36, D37, D38) |
| CCSI permit Manado | nilaiPoPermit Kalawiran 10.212.800 / Karondoran 12.176.000; permitCost = realisasi permit **10.035.446,29 / 11.964.553,71** (22.000.000 pro-rata nilai permit, sisa pembulatan ke Karondoran); audit `alasan` = "permit pass-through dari sheet CCSI"; termin PERMIT 1 × 100% INVOICED (INV-RAA/001 & 002/IX/2026) |
| SND Kalawiran 4.373.496 | Daftar ditahan, jenis REVENUE (tidak bisa dilepas jadi biaya) |
| PJD Evantama 10 item | semua ke Cluster Sinagar Tasik: pos Allowance Sinagar = **13.775.000** |
| ADW "Alloawance CJ Ngawi" 10.000.000 | pro-rata 5 cluster TEPAS NGAWI |
| ADW PJD C67 (25/05), C68 (17/06), C70 (13/08) | pro-rata ke cluster dengan tanggal implementasi ≤ tanggal expense (kosong ikut): **10 / 10 / 19** cluster |
| CCSI Site Semarang | Term 1 7.445.482 & Allowance 2.812.450 → Padangsari; Biaya Permit 36.000.000 **ditahan** |
| Import ulang | NEW 0, CHANGED 0 |

Total CCSI di rekap (acuan C + permit Manado), dengan interest 10% dan retensiAsCost = true:
nilaiProyek 136.073.359 + 22.388.800 = **158.462.159**. Profit −1.871.953 − (22.000.000 + pajak 559.720 + interest
2.255.972 − 22.388.800) = **−4.298.845**. Acuan C level parser (file Excel) tidak berubah.

## P. Fase 2.3 — PO per cluster, margin permit, default retensi = piutang

Dites di `packages/shared/src/calc/po.test.ts`, `packages/shared/test/acceptance-rab.test.ts`,
`apps/api/test/{budget,realization,phase23}.e2e-spec.ts` dan `e2e/phase{1,2}.spec.ts`.

**Default baru `retensiAsCost = false` (retensi = piutang).** Acuan A–F tetap dites dengan `retensiAsCost = true`
eksplisit (shared: fixture; API: `?retensiAsCost=true`; e2e: preview toggle).

| Acuan | Nilai |
|---|---|
| WANASARI RW 01, default (retensi = piutang) | danaInvestor 7.708.168 · interest 770.816,80 · **profit 961.865,20** |
| WANASARI RW 01, retensiAsCost = true | profit −76.628,30 (acuan A tidak berubah) |

**Nilai PO diturunkan dari tabel PO** (rumus budget tidak berubah):
`nilaiPoImpl = Σ IMPLEMENTASI + ADDWORK + DEDUCTION`, `nilaiPoPermit = Σ PERMIT + SND`, `permitCost = Σ passThroughCost`.
Contoh: IMPL 33.650.100 + ADDWORK 398.300 + DEDUCTION −730.800 = **33.317.600**; PERMIT 10.212.800 + SND 4.373.496 =
**14.586.296**; pass-through 10.035.446,29. DEDUCTION > 0 atau jenis lain < 0 ditolak.

**Margin permit** = nilaiPoPermit − permitCost − pajakRate × nilaiPoPermit − interestRate × permitCost

| Cluster | PO permit | Biaya permit | Pajak | Interest | Margin permit |
|---|---|---|---|---|---|
| Sinagar (pajak 2,65%) | 37.000.000 | 37.000.000 | 980.500 | 3.700.000 | **−4.680.500** |
| Padangsari Semarang (pajak 2,5%) | 36.000.000 | 36.000.000 | 900.000 | 3.600.000 | **−4.500.000** |
| Tanpa permit | 0 | 0 | 0 | 0 | 0 |

**Penyesuaian PO ADW** (baris 10 "Deduction Termin 1 + Addwork", kolom Realisasi). Tanda dari rumus baris 11;
sel berumus konstanta dipecah per suku.

| Sel | Isi | Rumus baris 11 | PO |
|---|---|---|---|
| M10 | −755.900 | `M9+M10` | DEDUCTION −755.900 |
| Z10 | 1.058.900 | `Z9-Z10` | DEDUCTION −1.058.900 |
| AD10 | −1.081.700 | `AD9+AD10` | DEDUCTION −1.081.700 |
| AL10 | `=398300-730800` | `AL9+AL10` | ADDWORK 398.300 + DEDUCTION −730.800 |
| AP10 | `=522700-736000` | `AP9+AP10` | ADDWORK 522.700 + DEDUCTION −736.000 |
| BN10 | 210.000 | `BN9-BN10` | DEDUCTION −210.000 |
| Σ | | | **−3.652.300** |

**Total CCSI (retensiAsCost = true, interest 10%)** = acuan O + SND Kalawiran + permit Semarang:

- nilaiProyek 158.462.159 + 4.373.496 + 36.000.000 = **198.835.655**
- SND: profit + 4.373.496 × (1 − 2,5% − 10% × 2,5%) = +4.253.224,86
- Semarang pass-through: profit −(pajak 900.000 + interest 10% × 36.900.000) = −4.590.000
- profit −4.298.845 + 4.253.224,86 − 4.590.000 = **−4.635.620,14**

**Keputusan 2.3 (patch `2.3-po-permit-semarang-fee-marketing`)**

| Keputusan | Hasil yang dites |
|---|---|
| SND Kalawiran | PO SND FTTHSWI-5-280926 4.373.496, pass-through 0; termin SND 1 × 100% INVOICED (INV-RAA/003/IX/2026), tanggal invoice kosong → badge; item ditahan → RELEASED (`PO_SND`) |
| Permit Semarang | PO PERMIT 36.000.000 / pass-through 36.000.000, catatan "konfirmasi user 14 Okt 2026"; J31 → realisasi PERMIT 36.000.000 ke Padangsari; termin permit UNBILLED, tanggal kosong → badge |
| CCSI C58 "Wenda Manado Sulut" 4.000.000 | kategori MARKETING_FEE → pos MARKETING, PRO_RATA_PO Kalawiran & Karondoran, catatan "fee marketing — konfirmasi user 14 Okt 2026" |
| Daftar ditahan | **0 item** setelah import |
| Import budget (file contoh) | permit Manado & Semarang = **Dilindungi** (diedit di aplikasi); cluster lain Sama; timpa per field hanya ADMIN + alasan |
| Over budget | realisasi TICKET 250.000 pada budget 0 → notifikasi PM & DIREKTUR sekali (kunci `OVER:{cluster}:{pos}`), muncul di Rekap; expense dihapus → notifikasi dilepas |
| Referensi tagihan RAB | diterapkan manual: bruto 1.000.000, net 980.000 → PAID, potongan 20.000 jadi expense PAJAK; tidak bisa diterapkan dua kali |

## Q. Fase 2.4 — PPN pada termin klien & pencocokan referensi RAB

Dites di `packages/shared/src/calc/ppn.test.ts`, `apps/api/test/{phase23,realization}.e2e-spec.ts`, `e2e/phase2.spec.ts`.

ClientPayment.amount = **DPP**. ppnRate default dari Setting (0,11); pphRate default = pajakRate cluster.

| Besaran | Rumus | Sinagar permit termin 1 |
|---|---|---|
| DPP | 50% × PO permit 37.000.000 | 18.500.000 |
| PPN keluaran (titipan) | DPP × 11% | **2.035.000** |
| Tagihan | DPP + PPN | 20.535.000 |
| PPh | DPP × 2,65% | 490.250 |
| Net diharapkan | DPP + PPN − PPh | **20.044.750** (= referensi RAB I2628-00139) |
| PAJAK otomatis saat PAID | DPP + PPN − diterima | **490.250** |
| Profit realisasi | DPP − realisasi biaya (termasuk PAJAK) | PPN tidak menambah/mengurangi profit |

Pencocokan: referensi cocok bila |net − net diharapkan| ≤ Rp 10. Kandidat ganda → dipilih nomor termin yang sama;
tetap ganda → "pilih manual". Usulan tidak pernah diterapkan tanpa konfirmasi FINANCE (per baris atau "Terapkan semua
yang cocok"). Referensi Paid tanpa jatuh tempo → status Dibayar dengan tanda "tanggal diterima belum diisi".

## R. Fase 2.4 — Addwork/Deduction mengoreksi termin 1

Termin 1 PO implementasi utama = template% × PO dasar + Σ ADDWORK/DEDUCTION. PO addwork/deduction tidak punya termin.
Contoh WANASARI RW 02 (ADW 80/10/10, PO 13.949.300) + addwork 400.000 + deduction −150.000:
termin 1 = 11.159.440 + 250.000 = **11.409.440**; Σ termin = 14.199.300. Bila termin 1 sudah ditagih/dibayar, koreksi
masuk ke termin UNBILLED berikutnya dengan peringatan (dites: +100.000 setelah termin 1 ditagih → termin 2 =
1.394.930 + 350.000). Hitung ulang menghapus termin terpisah gaya Fase 2.3 (diff "Dihapus").

Preview DB Docker (6 cluster ADW, belum diterapkan): termin 1 Batumpang 20.063.840 → 19.307.940; TEPAS RW 07 distribusi
14.315.920 → 13.257.020; TEPAS RW 07 subfeeder 9.250.880 → 8.169.180; TEPAS RW 05-REV 26.924.080 → 26.591.580;
TEPAS RW 05 subfeeder 8.581.840 → 8.368.540; Gunungtawang subfeeder 13.265.280 → 13.055.280; 8 termin terpisah dihapus.

## S. Fase 2.4 — margin permit hanya PO PERMIT; notifikasi over budget

- Margin permit = Σ PO PERMIT − biaya permit − pajak × Σ PO PERMIT − interest × biaya permit. SND tetap masuk
  nilaiProyek. Kalawiran: 10.212.800 − 10.035.446,29 − 255.320 − 1.003.544,63 = **−1.081.510,92** (sebelumnya
  +3.182.648 karena SND). Total CCSI: −1.081.510,92 − 1.289.409,08 − 4.500.000 = **−6.870.920**.
- Over budget: TOTAL cluster ≥ ambang → notifikasi langsung PM & DIREKTUR, sekali per lintasan (status OverrunState;
  turun lalu naik lagi = lintasan baru). Pos > ambang → "Ringkasan harian" (1 notifikasi per user per hari,
  pos baru ditambahkan, pos yang sama tidak diulang).
