import type { PoKind } from '../enums';
import { dec, sum, type D, type Num } from './decimal';

export interface PoRow {
  kind: PoKind;
  amount: Num;
  passThroughCost?: Num | null;
}

/**
 * Nilai turunan cluster dari tabel PO:
 *   nilaiPoImpl   = Σ IMPLEMENTASI + ADDWORK + DEDUCTION (DEDUCTION negatif)
 *   nilaiPoPermit = Σ PERMIT + SND
 *   permitCost    = Σ passThroughCost
 */
export function derivePoTotals(pos: PoRow[]): { nilaiPoImpl: D; nilaiPoPermit: D; permitCost: D; permitPoAmount: D } {
  const of = (kinds: PoKind[]) => sum(pos.filter((p) => kinds.includes(p.kind)).map((p) => p.amount));
  return {
    nilaiPoImpl: of(['IMPLEMENTASI', 'ADDWORK', 'DEDUCTION']),
    nilaiPoPermit: of(['PERMIT', 'SND']),
    permitCost: sum(pos.map((p) => dec(p.passThroughCost))),
    /** Σ PERMIT saja — dasar margin permit (tanpa SND). */
    permitPoAmount: of(['PERMIT']),
  };
}

/** Validasi tanda nilai PO: DEDUCTION ≤ 0, jenis lain ≥ 0. */
export function poAmountError(kind: PoKind, amount: Num): string | null {
  const a = dec(amount);
  if (kind === 'DEDUCTION' && a.gt(0)) return 'Deduction harus bernilai negatif';
  if (kind !== 'DEDUCTION' && a.isNegative() && !a.isZero()) return 'Nilai PO tidak boleh negatif';
  return null;
}

/**
 * Nomor PO dari teks info cluster.
 *  - "PO: PO/2026/07774" / "PO/2026/09244" → implementasi
 *  - "Permit PO 665/PERMIT/ENS/0726" → permit
 *  - "PO Cluster: 754/FTTH/ENS/0826 PO Subfeeder: 978/FTTH/ENS/0926" → implementasi (dua nomor)
 */
export function parsePoNumbers(info: string | null | undefined): { implementasi: string[]; permit: string[] } {
  const text = info ?? '';
  const permit = [...text.matchAll(/Permit PO:?\s*([\w/.-]+)/gi)].map((m) => m[1]);
  const rest = text.replace(/Permit PO:?\s*[\w/.-]+/gi, '');
  const labelled = [...rest.matchAll(/PO(?: Cluster| Subfeeder)?\s*:\s*([A-Z0-9][\w/.-]*\d)/gi)].map((m) => m[1]);
  const bare = [...rest.matchAll(/\b(PO\/\d{4}\/\d+)\b/g)].map((m) => m[1]);
  const implementasi = [...new Set([...labelled, ...bare])].filter((n) => !permit.includes(n));
  return { implementasi, permit };
}

