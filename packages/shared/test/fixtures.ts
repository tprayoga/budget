import type { ClusterCalcInput } from '../src/calc/budget';

/** Acceptance A: ADW — WANASARI RW 01 SUBANG. */
export function wanasari(overrides: Partial<ClusterCalcInput> = {}): ClusterCalcInput {
  return {
    nilaiPoImpl: '9440850',
    nilaiPoPermit: '0',
    permitCost: '0',
    pajakRate: '0.025',
    retensiRate: '0.10',
    interestRate: '0.10',
    retensiAsCost: true,
    lines: [
      { code: 'SUBCON', mode: 'RP', amount: '6952900' },
      { code: 'TICKET', mode: 'PCT', pct: '0' },
      { code: 'INDIRECT', mode: 'PCT', pct: '0.01' },
      { code: 'DIRECT', mode: 'PCT', pct: '0.015' },
      { code: 'OPS_KANTOR', mode: 'PCT', pct: '0.01' },
      { code: 'MOTOR_MOBIL', mode: 'PCT', pct: '0' },
      { code: 'HOMEBASE', mode: 'PCT', pct: '0' },
      { code: 'ALLOWANCE', mode: 'PCT', pct: '0.01' },
      { code: 'MARKETING', mode: 'PCT', pct: '0.01' },
    ],
    ...overrides,
  };
}
