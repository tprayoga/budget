import { FR_CODES, type FrCode } from '../enums';
import { D, dec, roundMoney, safeDiv, sum, type Num } from './decimal';

export type RealizationLevel = 'ok' | 'warn' | 'over';

export interface RealizationRow {
  code: FrCode;
  budget: D;
  realisasi: D;
  sisa: D;
  /** realisasi / budget (0 bila budget 0). */
  pctTerpakai: D;
  level: RealizationLevel;
  /** Expense yang masih PERLU_VERIFIKASI (tidak dihitung). */
  menungguVerifikasi: D;
}

/**
 * Level warna: kuning bila % terpakai > warnPct (default dari Setting, 0,80), merah bila > 100%.
 * Budget 0 tetapi ada realisasi → merah.
 */
export function realizationLevel(budget: Num, realisasi: Num, warnPct: Num): RealizationLevel {
  const b = dec(budget);
  const r = dec(realisasi);
  if (b.isZero()) return r.gt(0) ? 'over' : 'ok';
  const pct = r.div(b);
  if (pct.gt(1)) return 'over';
  if (pct.gt(dec(warnPct))) return 'warn';
  return 'ok';
}

export function calcRealization(
  budgetByCode: Partial<Record<FrCode, Num>>,
  realizedByCode: Partial<Record<FrCode, Num>>,
  warnPct: Num,
  pendingByCode: Partial<Record<FrCode, Num>> = {},
) {
  const rows: RealizationRow[] = FR_CODES.map((code) => {
    const budget = dec(budgetByCode[code]);
    const realisasi = dec(realizedByCode[code]);
    return {
      code,
      budget,
      realisasi,
      sisa: budget.minus(realisasi),
      pctTerpakai: safeDiv(realisasi, budget),
      level: realizationLevel(budget, realisasi, warnPct),
      menungguVerifikasi: dec(pendingByCode[code]),
    };
  });
  const budget = sum(rows.map((r) => r.budget));
  const realisasi = sum(rows.map((r) => r.realisasi));
  return {
    rows,
    total: {
      budget,
      realisasi,
      sisa: budget.minus(realisasi),
      pctTerpakai: safeDiv(realisasi, budget),
      level: realizationLevel(budget, realisasi, warnPct),
      menungguVerifikasi: sum(rows.map((r) => r.menungguVerifikasi)),
    },
  };
}

/**
 * Pajak termin klien (Fase 2.4). amount = DPP.
 *   PPN keluaran   = DPP × ppnRate (titipan — bukan pendapatan maupun biaya)
 *   invoiceTotal   = DPP + PPN
 *   PPh dipotong   = DPP × pphRate (default pajakRate cluster)
 *   expectedNet    = DPP + PPN − PPh  (nilai yang diterima dari klien)
 * Nilai rupiah dibulatkan 2 desimal (half-up).
 * Contoh: Sinagar permit termin 1, DPP 18.500.000, PPN 11%, PPh 2,65% → net 20.044.750.
 */
export function terminTax(input: { amount: Num; ppnRate?: Num | null; pphRate?: Num | null }) {
  const dpp = dec(input.amount);
  const ppn = roundMoney(dpp.times(dec(input.ppnRate)));
  const pph = roundMoney(dpp.times(dec(input.pphRate)));
  const invoiceTotal = dpp.plus(ppn);
  return { dpp, ppn, invoiceTotal, pph, expectedNet: invoiceTotal.minus(pph) };
}

/**
 * Profit realisasi = Σ DPP termin klien berstatus PAID − Σ realisasi biaya terverifikasi
 * (termasuk expense PAJAK otomatis = DPP + PPN − diterima). Kas diterima = Σ paidAmount (termasuk PPN titipan).
 * PPN titipan = Σ PPN termin PAID — tidak masuk pendapatan maupun biaya.
 */
export function calcRealizedProfit(
  payments: { status: string; amount: Num; paidAmount?: Num | null; ppnRate?: Num | null }[],
  realisasiBiaya: Num,
) {
  const paid = payments.filter((p) => p.status === 'PAID');
  const pembayaranBruto = sum(paid.map((p) => p.amount));
  const kasDiterima = sum(paid.map((p) => p.paidAmount ?? 0));
  const ppnTitipan = sum(paid.map((p) => terminTax({ amount: p.amount, ppnRate: p.ppnRate }).ppn));
  const biaya = dec(realisasiBiaya);
  return { pembayaranBruto, kasDiterima, ppnTitipan, realisasiBiaya: biaya, profitRealisasi: pembayaranBruto.minus(biaya) };
}

/** Selisih nilai referensi tagihan vs expectedNet termin yang dianggap cocok (± Rp 10). */
export const REF_MATCH_TOLERANCE = 10;

/**
 * Usulan pencocokan referensi tagihan RAB → termin: |net − expectedNet| ≤ toleransi.
 * Bila lebih dari satu kandidat, pilih yang nomor terminnya sama dengan referensi; tetap ganda → tidak cocok (null).
 */
export function matchReferenceToTermin<T extends { id: string; termin: number; expectedNet: Num }>(
  ref: { netAmount: Num | null | undefined; termin?: number | null },
  candidates: T[],
  tolerance: Num = REF_MATCH_TOLERANCE,
): { match: T | null; ambiguous: boolean } {
  if (ref.netAmount === null || ref.netAmount === undefined) return { match: null, ambiguous: false };
  const net = dec(ref.netAmount);
  const hits = candidates.filter((c) => dec(c.expectedNet).minus(net).abs().lte(dec(tolerance)));
  if (hits.length === 1) return { match: hits[0], ambiguous: false };
  if (hits.length > 1) {
    const same = hits.filter((h) => ref.termin != null && h.termin === ref.termin);
    if (same.length === 1) return { match: same[0], ambiguous: false };
    return { match: null, ambiguous: true };
  }
  return { match: null, ambiguous: false };
}

/**
 * Potongan pembayaran klien yang dicatat sebagai expense PAJAK = tagihan (DPP + PPN) − diterima
 * (0 bila tidak ada potongan). Parameter pertama = invoiceTotal (DPP + PPN).
 */
export function paymentDeduction(amount: Num, paidAmount: Num | null | undefined): D {
  if (paidAmount === null || paidAmount === undefined || paidAmount === '') return new D(0);
  const diff = dec(amount).minus(dec(paidAmount));
  return diff.gt(0) ? diff : new D(0);
}

/** Panel pengajuan: dana cair vs realisasi vs sisa dana di tangan, per pos. */
export function calcFundUsage(cairByCode: Partial<Record<FrCode, Num>>, realizedByCode: Partial<Record<FrCode, Num>>) {
  const rows = FR_CODES.map((code) => {
    const cair = dec(cairByCode[code]);
    const realisasi = dec(realizedByCode[code]);
    return { code, cair, realisasi, sisa: cair.minus(realisasi) };
  });
  const cair = sum(rows.map((r) => r.cair));
  const realisasi = sum(rows.map((r) => r.realisasi));
  return { rows, total: { cair, realisasi, sisa: cair.minus(realisasi) } };
}
