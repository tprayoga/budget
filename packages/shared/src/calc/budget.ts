import { BUDGET_LINE_CODES, COST_PROJECT_CODES, type BudgetLineCode, type LineMode } from '../enums';
import { D, dec, safeDiv, sum, type Num } from './decimal';

export interface BudgetLineInput {
  code: BudgetLineCode;
  mode: LineMode;
  pct?: Num | null;
  amount?: Num | null;
}

export interface ClusterCalcInput {
  nilaiPoImpl: Num;
  nilaiPoPermit?: Num | null;
  /** Σ PO kind PERMIT saja (tanpa SND) — dasar margin permit. Default = nilaiPoPermit. */
  permitPoAmount?: Num | null;
  permitCost?: Num | null;
  pajakRate: Num;
  retensiRate: Num;
  lines: BudgetLineInput[];
  interestRate: Num;
  retensiAsCost: boolean;
}

export interface CalcItem {
  /** Nilai rupiah presisi penuh. */
  amount: D;
  /** Persentase tampilan terhadap basisnya. */
  pct: D;
}

export interface LineCalc extends CalcItem {
  code: BudgetLineCode;
  mode: LineMode;
}

export interface ClusterCalcResult {
  nilaiPoImpl: D;
  nilaiPoPermit: D;
  nilaiProyek: D;
  lines: Record<BudgetLineCode, LineCalc>;
  permit: CalcItem;
  pajak: CalcItem;
  retensi: CalcItem;
  /** Retensi yang ikut dihitung sebagai biaya (0 bila retensiAsCost = false). */
  retensiCost: D;
  costProject: CalcItem;
  danaInvestor: CalcItem;
  interest: CalcItem;
  outflow: CalcItem;
  profit: D;
  margin: D;
  /** Margin permit = PO PERMIT − permitCost − pajak atas PO PERMIT − interest atas permitCost (indikator; SND tidak termasuk). */
  marginPermit: D;
}

/**
 * Margin permit (indikator): PO PERMIT − permitCost − pajakRate × PO PERMIT − interestRate × permitCost.
 * Fase 2.4: hanya PO kind PERMIT — SND tetap masuk nilaiProyek tetapi tidak dihitung di margin permit.
 * Permit tetap masuk dasar pajak & interest di rumus utama; indikator ini menunjukkan apakah permit (pass-through) rugi.
 */
export function calcPermitMargin(input: { nilaiPoPermit?: Num | null; permitCost?: Num | null; pajakRate: Num; interestRate: Num }): D {
  const po = dec(input.nilaiPoPermit);
  const cost = dec(input.permitCost);
  return po.minus(cost).minus(dec(input.pajakRate).times(po)).minus(dec(input.interestRate).times(cost));
}

/**
 * Kalkulasi budget satu cluster. Rumus persis sesuai spesifikasi Fase 1:
 *   nilaiProyek  = nilaiPoImpl + nilaiPoPermit
 *   line         = PCT → pct × nilaiPoImpl ; RP → amount (pct tampilan = amount / nilaiPoImpl)
 *   biayaPermit  = permitCost (pct tampilan = permitCost / nilaiPoPermit)
 *   pajak        = pajakRate × nilaiProyek
 *   retensi      = retensiRate × nilaiPoImpl
 *   danaInvestor = SUBCON + permit + TICKET + pajak + (retensiAsCost ? retensi : 0) + costProject
 *   interest     = interestRate × danaInvestor
 *   outflow      = danaInvestor + interest
 *   profit       = nilaiProyek − outflow
 *   margin       = nilaiProyek = 0 ? 0 : profit / nilaiProyek
 * Semua dihitung presisi penuh; pembulatan hanya saat disimpan/ditampilkan.
 */
export function calcCluster(input: ClusterCalcInput): ClusterCalcResult {
  const nilaiPoImpl = dec(input.nilaiPoImpl);
  const nilaiPoPermit = dec(input.nilaiPoPermit);
  const nilaiProyek = nilaiPoImpl.plus(nilaiPoPermit);
  const base = nilaiPoImpl;

  const byCode = new Map(input.lines.map((l) => [l.code, l]));
  const lines = {} as Record<BudgetLineCode, LineCalc>;
  for (const code of BUDGET_LINE_CODES) {
    const l = byCode.get(code);
    if (!l) {
      lines[code] = { code, mode: 'PCT', amount: new D(0), pct: new D(0) };
    } else if (l.mode === 'PCT') {
      const pct = dec(l.pct);
      lines[code] = { code, mode: 'PCT', pct, amount: pct.times(base) };
    } else {
      const amount = dec(l.amount);
      lines[code] = { code, mode: 'RP', amount, pct: safeDiv(amount, base) };
    }
  }

  const permitAmount = dec(input.permitCost);
  const permit: CalcItem = { amount: permitAmount, pct: safeDiv(permitAmount, nilaiPoPermit) };
  const pajakRate = dec(input.pajakRate);
  const pajak: CalcItem = { amount: pajakRate.times(nilaiProyek), pct: pajakRate };
  const retensiRate = dec(input.retensiRate);
  const retensi: CalcItem = { amount: retensiRate.times(nilaiPoImpl), pct: retensiRate };
  const retensiCost = input.retensiAsCost ? retensi.amount : new D(0);

  const costProjectAmount = sum(COST_PROJECT_CODES.map((c) => lines[c].amount));
  const danaInvestorAmount = sum([
    lines.SUBCON.amount,
    permit.amount,
    lines.TICKET.amount,
    pajak.amount,
    retensiCost,
    costProjectAmount,
  ]);
  const interestRate = dec(input.interestRate);
  const interestAmount = interestRate.times(danaInvestorAmount);
  const outflowAmount = danaInvestorAmount.plus(interestAmount);
  const profit = nilaiProyek.minus(outflowAmount);

  return {
    nilaiPoImpl,
    nilaiPoPermit,
    nilaiProyek,
    lines,
    permit,
    pajak,
    retensi,
    retensiCost,
    costProject: { amount: costProjectAmount, pct: safeDiv(costProjectAmount, base) },
    danaInvestor: { amount: danaInvestorAmount, pct: safeDiv(danaInvestorAmount, nilaiProyek) },
    interest: { amount: interestAmount, pct: interestRate },
    outflow: { amount: outflowAmount, pct: safeDiv(outflowAmount, nilaiProyek) },
    profit,
    margin: safeDiv(profit, nilaiProyek),
    marginPermit: calcPermitMargin({
      nilaiPoPermit: input.permitPoAmount === undefined || input.permitPoAmount === null ? nilaiPoPermit : input.permitPoAmount,
      permitCost: permitAmount,
      pajakRate,
      interestRate,
    }),
  };
}

export interface ProjectTotal {
  clusterCount: number;
  nilaiPoImpl: D;
  nilaiPoPermit: D;
  nilaiProyek: D;
  lines: Record<BudgetLineCode, D>;
  permit: D;
  pajak: D;
  retensi: D;
  retensiCost: D;
  costProject: D;
  danaInvestor: D;
  interest: D;
  outflow: D;
  profit: D;
  margin: D;
  marginPermit: D;
}

/**
 * Total project = penjumlahan hasil per cluster (presisi penuh, bukan dihitung ulang dari %).
 * Pembulatan dilakukan setelah penjumlahan, oleh pemanggil.
 */
export function calcProjectTotal(results: ClusterCalcResult[]): ProjectTotal {
  const s = (pick: (r: ClusterCalcResult) => D) => sum(results.map(pick));
  const lines = {} as Record<BudgetLineCode, D>;
  for (const code of BUDGET_LINE_CODES) lines[code] = s((r) => r.lines[code].amount);
  const nilaiProyek = s((r) => r.nilaiProyek);
  const profit = s((r) => r.profit);
  return {
    clusterCount: results.length,
    nilaiPoImpl: s((r) => r.nilaiPoImpl),
    nilaiPoPermit: s((r) => r.nilaiPoPermit),
    nilaiProyek,
    lines,
    permit: s((r) => r.permit.amount),
    pajak: s((r) => r.pajak.amount),
    retensi: s((r) => r.retensi.amount),
    retensiCost: s((r) => r.retensiCost),
    costProject: s((r) => r.costProject.amount),
    danaInvestor: s((r) => r.danaInvestor.amount),
    interest: s((r) => r.interest.amount),
    outflow: s((r) => r.outflow.amount),
    profit,
    margin: safeDiv(profit, nilaiProyek),
    marginPermit: s((r) => r.marginPermit),
  };
}

/** Ringkasan cluster/total yang dikirim lewat API (string, 2 desimal untuk uang, 8 untuk rasio). */
export interface CalcSummaryDto {
  nilaiPoImpl: string;
  nilaiPoPermit: string;
  nilaiProyek: string;
  lines: Record<BudgetLineCode, { mode?: LineMode; amount: string; pct: string }>;
  permit: { amount: string; pct: string };
  pajak: { amount: string; pct: string };
  retensi: { amount: string; pct: string };
  retensiCost: string;
  costProject: string;
  danaInvestor: string;
  interest: string;
  outflow: string;
  profit: string;
  margin: string;
  marginPermit: string;
}

const m = (v: D) => v.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const r = (v: D) => v.toDecimalPlaces(8, D.ROUND_HALF_UP).toFixed(8);

export function clusterResultToDto(res: ClusterCalcResult): CalcSummaryDto {
  const lines = {} as CalcSummaryDto['lines'];
  for (const code of BUDGET_LINE_CODES) {
    const l = res.lines[code];
    lines[code] = { mode: l.mode, amount: m(l.amount), pct: r(l.pct) };
  }
  return {
    nilaiPoImpl: m(res.nilaiPoImpl),
    nilaiPoPermit: m(res.nilaiPoPermit),
    nilaiProyek: m(res.nilaiProyek),
    lines,
    permit: { amount: m(res.permit.amount), pct: r(res.permit.pct) },
    pajak: { amount: m(res.pajak.amount), pct: r(res.pajak.pct) },
    retensi: { amount: m(res.retensi.amount), pct: r(res.retensi.pct) },
    retensiCost: m(res.retensiCost),
    costProject: m(res.costProject.amount),
    danaInvestor: m(res.danaInvestor.amount),
    interest: m(res.interest.amount),
    outflow: m(res.outflow.amount),
    profit: m(res.profit),
    margin: r(res.margin),
    marginPermit: m(res.marginPermit),
  };
}

export function projectTotalToDto(t: ProjectTotal): CalcSummaryDto {
  const lines = {} as CalcSummaryDto['lines'];
  for (const code of BUDGET_LINE_CODES) {
    lines[code] = { amount: m(t.lines[code]), pct: r(safeDiv(t.lines[code], t.nilaiPoImpl)) };
  }
  return {
    nilaiPoImpl: m(t.nilaiPoImpl),
    nilaiPoPermit: m(t.nilaiPoPermit),
    nilaiProyek: m(t.nilaiProyek),
    lines,
    permit: { amount: m(t.permit), pct: r(safeDiv(t.permit, t.nilaiPoPermit)) },
    pajak: { amount: m(t.pajak), pct: r(safeDiv(t.pajak, t.nilaiProyek)) },
    retensi: { amount: m(t.retensi), pct: r(safeDiv(t.retensi, t.nilaiPoImpl)) },
    retensiCost: m(t.retensiCost),
    costProject: m(t.costProject),
    danaInvestor: m(t.danaInvestor),
    interest: m(t.interest),
    outflow: m(t.outflow),
    profit: m(t.profit),
    margin: r(t.margin),
    marginPermit: m(t.marginPermit),
  };
}
