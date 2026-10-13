import { BUDGET_LABEL, RATE_DP, dec, type BudgetLineCode, type ClusterCalcResult, type LineMode } from '@indotek/shared';
import type { BudgetLine, Cluster } from '../api/types';

export type ClusterField = 'nilaiPoImpl' | 'nilaiPoPermit' | 'permitCost' | 'pajakRate' | 'retensiRate';

function withLine(c: Cluster, code: BudgetLineCode, patch: Partial<BudgetLine>): Cluster {
  const exists = c.lines.some((l) => l.code === code);
  const lines = exists
    ? c.lines.map((l) => (l.code === code ? { ...l, ...patch } : l))
    : [...c.lines, { code, label: BUDGET_LABEL[code], mode: 'PCT' as LineMode, pct: '0', amount: null, ...patch }];
  return { ...c, lines };
}

/** Set nilai baris budget sesuai mode-nya (PCT → rasio, RP → rupiah). */
export function setLineValue(c: Cluster, code: BudgetLineCode, value: string): Cluster {
  const line = c.lines.find((l) => l.code === code);
  const mode = line?.mode ?? 'PCT';
  return withLine(c, code, mode === 'PCT' ? { pct: value, amount: null } : { amount: value, pct: null });
}

/**
 * Ganti mode sel %/Rp tanpa mengubah nilai rupiahnya:
 * PCT → RP: amount = hasil kalkulasi (2 desimal); RP → PCT: pct = amount / nilaiPoImpl (12 desimal, presisi DB).
 */
export function toggleLineMode(c: Cluster, code: BudgetLineCode, calc: ClusterCalcResult): Cluster {
  const line = c.lines.find((l) => l.code === code);
  const current = line?.mode ?? 'PCT';
  const lc = calc.lines[code];
  if (current === 'PCT') {
    return withLine(c, code, { mode: 'RP', amount: lc.amount.toDecimalPlaces(2).toString(), pct: null });
  }
  return withLine(c, code, { mode: 'PCT', pct: lc.pct.toDecimalPlaces(RATE_DP).toString(), amount: null });
}

export function setField(c: Cluster, field: ClusterField, value: string): Cluster {
  return { ...c, [field]: value };
}

/** Payload PATCH /clusters/:id dari cluster hasil edit. */
export function toUpdatePayload(c: Cluster) {
  return {
    nilaiPoImpl: c.nilaiPoImpl,
    nilaiPoPermit: c.nilaiPoPermit,
    permitCost: c.permitCost,
    pajakRate: c.pajakRate,
    retensiRate: c.retensiRate,
    lines: c.lines.map((l) => ({ code: l.code, mode: l.mode, pct: l.mode === 'PCT' ? l.pct ?? '0' : null, amount: l.mode === 'RP' ? l.amount ?? '0' : null })),
  };
}

/** Apakah dua cluster berbeda pada nilai input (dibandingkan numerik). */
export function isClusterChanged(a: Cluster, b: Cluster): boolean {
  const eq = (x: string | null, y: string | null) => (x === null || y === null ? x === y : dec(x).eq(dec(y)));
  const fields: ClusterField[] = ['nilaiPoImpl', 'nilaiPoPermit', 'permitCost', 'pajakRate', 'retensiRate'];
  if (fields.some((f) => !eq(a[f], b[f]))) return true;
  return a.lines.some((l) => {
    const o = b.lines.find((x) => x.code === l.code);
    return !o || o.mode !== l.mode || !eq(l.pct, o.pct) || !eq(l.amount, o.amount);
  });
}
