import { FR_CODES, type FrCode } from '../enums';
import { D, dec, safeDiv, sum, type Num } from './decimal';

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
 * Profit realisasi = Σ nilai bruto termin klien berstatus PAID − Σ realisasi biaya terverifikasi
 * (termasuk expense PAJAK otomatis dari potongan pembayaran). Kas diterima = Σ paidAmount.
 */
export function calcRealizedProfit(
  payments: { status: string; amount: Num; paidAmount?: Num | null }[],
  realisasiBiaya: Num,
) {
  const paid = payments.filter((p) => p.status === 'PAID');
  const pembayaranBruto = sum(paid.map((p) => p.amount));
  const kasDiterima = sum(paid.map((p) => p.paidAmount ?? 0));
  const biaya = dec(realisasiBiaya);
  return { pembayaranBruto, kasDiterima, realisasiBiaya: biaya, profitRealisasi: pembayaranBruto.minus(biaya) };
}

/** Selisih potongan pembayaran klien yang dicatat sebagai expense PAJAK (0 bila tidak ada potongan). */
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
