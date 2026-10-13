import type { AllocationMethod } from '../enums';
import { D, dec, roundMoney, sum, type Num } from './decimal';

export interface AllocationTarget {
  clusterId: string;
  /** nilaiPoImpl (dipakai PRO_RATA_PO). */
  nilaiPoImpl?: Num;
  /** Nominal untuk metode MANUAL (satu expense). */
  manualAmount?: Num;
  /** Porsi 0..1 untuk metode MANUAL berbasis persentase (grup import); Σ harus 1. */
  manualPct?: Num;
}

export interface AllocationLine {
  clusterId: string;
  amount: D;
  /** Porsi terhadap expense (0..1). */
  pct: D;
}

/** Bobot per target untuk metode EQUAL / PRO_RATA_PO. */
function weights(targets: AllocationTarget[], method: Exclude<AllocationMethod, 'MANUAL'>): D[] {
  if (method === 'EQUAL') return targets.map(() => new D(1));
  const w = targets.map((t) => dec(t.nilaiPoImpl));
  if (w.some((x) => x.isNegative())) throw new Error('nilaiPoImpl tidak boleh negatif');
  if (sum(w).isZero()) throw new Error('Pro-rata tidak bisa dipakai: total nilai PO implementasi 0');
  return w;
}

/**
 * Alokasikan sekelompok expense (mis. semua item OPS satu section) ke beberapa cluster.
 * Pembulatan HALF_UP 2 desimal dilakukan pada nilai KUMULATIF, sehingga:
 *  - setiap item teralokasi tepat sebesar nominalnya, dan
 *  - total per cluster = alokasi total grup (selisih pembulatan masuk ke cluster terakhir).
 * Contoh: 10.735.600 rata ke 3 cluster → 3.578.533,33 / 3.578.533,33 / 3.578.533,34.
 */
export function allocateGroup(
  amounts: Num[],
  targets: AllocationTarget[],
  method: AllocationMethod,
): AllocationLine[][] {
  if (!targets.length) throw new Error('Minimal satu cluster tujuan alokasi');
  if (method === 'MANUAL' && targets.every((t) => t.manualPct !== undefined && t.manualPct !== null)) {
    // MANUAL persentase: dialokasikan kumulatif seperti pro-rata dengan bobot = persentase
    const w = targets.map((t) => dec(t.manualPct));
    if (!sum(w).eq(1)) throw new Error('Total persentase alokasi manual harus 100%');
    if (w.some((x) => x.isNegative())) throw new Error('Persentase alokasi tidak boleh negatif');
    return weightedGroup(amounts, targets, w);
  }
  if (method === 'MANUAL') {
    if (amounts.length !== 1) throw new Error('Alokasi manual hanya untuk satu expense');
    const total = dec(amounts[0]);
    const lines = targets.map((t) => ({ clusterId: t.clusterId, amount: roundMoney(dec(t.manualAmount)) }));
    if (!sum(lines.map((l) => l.amount)).eq(total)) {
      throw new Error('Total alokasi manual harus sama dengan nominal expense');
    }
    return [lines.map((l) => ({ ...l, pct: total.isZero() ? new D(0) : l.amount.div(total) }))];
  }
  return weightedGroup(amounts, targets, weights(targets, method));
}

function weightedGroup(amounts: Num[], targets: AllocationTarget[], w: D[]): AllocationLine[][] {
  const W = sum(w);
  const last = targets.length - 1;
  let cumPrev = new D(0);
  return amounts.map((a) => {
    const amount = dec(a);
    const cum = cumPrev.plus(amount);
    const lines: AllocationLine[] = [];
    let allocated = new D(0);
    targets.forEach((t, i) => {
      let share: D;
      if (i === last) share = amount.minus(allocated);
      else share = roundMoney(cum.times(w[i]).div(W)).minus(roundMoney(cumPrev.times(w[i]).div(W)));
      allocated = allocated.plus(share);
      lines.push({ clusterId: t.clusterId, amount: share, pct: amount.isZero() ? new D(0) : share.div(amount) });
    });
    cumPrev = cum;
    return lines;
  });
}

/** Alokasi satu expense. */
export function allocate(amount: Num, targets: AllocationTarget[], method: AllocationMethod): AllocationLine[] {
  return allocateGroup([amount], targets, method)[0];
}
