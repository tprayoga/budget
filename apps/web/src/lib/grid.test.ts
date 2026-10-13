import { calcCluster } from '@indotek/shared';
import { describe, expect, it } from 'vitest';
import type { Cluster } from '../api/types';
import { isClusterChanged, setLineValue, toggleLineMode, toUpdatePayload } from './grid';
import { calcClusterLocal, recalcProjects } from './budget';

const base: Cluster = {
  id: 'c1',
  projectId: 'p1',
  name: 'WANASARI RW 01 SUBANG',
  info: null,
  division: 'TELCO',
  status: 'ONGOING',
  sortOrder: 0,
  nilaiPoImpl: '9440850',
  nilaiPoPermit: '0',
  permitCost: '0',
  pajakRate: '0.025',
  retensiRate: '0.1',
  lines: [
    { code: 'SUBCON', label: 'Biaya Subcon', mode: 'RP', pct: null, amount: '6952900' },
    { code: 'TICKET', label: 'Ticket', mode: 'PCT', pct: '0', amount: null },
    { code: 'INDIRECT', label: 'Indirect', mode: 'PCT', pct: '0.01', amount: null },
    { code: 'DIRECT', label: 'Direct', mode: 'PCT', pct: '0.015', amount: null },
    { code: 'OPS_KANTOR', label: 'Ops', mode: 'PCT', pct: '0.01', amount: null },
    { code: 'MOTOR_MOBIL', label: 'Motor', mode: 'PCT', pct: '0', amount: null },
    { code: 'HOMEBASE', label: 'Homebase', mode: 'PCT', pct: '0', amount: null },
    { code: 'ALLOWANCE', label: 'Allowance', mode: 'PCT', pct: '0.01', amount: null },
    { code: 'MARKETING', label: 'Marketing', mode: 'PCT', pct: '0.01', amount: null },
  ],
};
const A = { interestRate: '0.1', retensiAsCost: true };

describe('grid edit', () => {
  it('kalkulasi lokal = acceptance A', () => {
    const r = calcClusterLocal(base, A);
    expect(r.profit.toFixed(2)).toBe('-76628.30');
  });

  it('toggle PCT → RP mempertahankan nilai rupiah', () => {
    const r = calcClusterLocal(base, A);
    const c = toggleLineMode(base, 'DIRECT', r);
    expect(c.lines.find((l) => l.code === 'DIRECT')).toMatchObject({ mode: 'RP', amount: '141612.75', pct: null });
    expect(calcClusterLocal(c, A).profit.toFixed(2)).toBe('-76628.30');
    expect(isClusterChanged(c, base)).toBe(true);
  });

  it('toggle RP → PCT dan kembali tidak mengubah profit', () => {
    const r = calcClusterLocal(base, A);
    const c = toggleLineMode(base, 'SUBCON', r);
    expect(c.lines.find((l) => l.code === 'SUBCON')!.mode).toBe('PCT');
    const back = toggleLineMode(c, 'SUBCON', calcCluster({ ...c, ...toUpdatePayload(c), ...A }));
    expect(back.lines.find((l) => l.code === 'SUBCON')!.amount).toBe('6952900');
    expect(calcClusterLocal(back, A).profit.toFixed(2)).toBe('-76628.30');
  });

  it('set nilai sesuai mode & payload', () => {
    const c = setLineValue(base, 'INDIRECT', '0.02');
    expect(calcClusterLocal(c, A).lines.INDIRECT.amount.toString()).toBe('188817');
    const p = toUpdatePayload(c);
    expect(p.lines.find((l) => l.code === 'INDIRECT')).toEqual({ code: 'INDIRECT', mode: 'PCT', pct: '0.02', amount: null });
    expect(isClusterChanged(base, { ...base })).toBe(false);
    // nilai PO diturunkan dari tabel PO → tidak ikut payload grid
    expect(p).not.toHaveProperty('nilaiPoImpl');
  });
});

describe('rekap what-if', () => {
  const project = { id: 'p1', code: 'ADW', name: 'ADW', year: 2026, client: { id: 'x', name: 'PT ADW' } };
  const setting = { interestRate: '0.1', retensiAsCost: true, rekeningBank: null, rekeningNo: null, rekeningNama: null, overridden: [] };
  const dummy = recalcProjects([{ project, setting, clusters: [{ ...base, calc: {} as never }], total: {} as never }], A);

  it('acceptance A & B lewat preview', () => {
    expect(dummy.projects[0].total.danaInvestor).toBe('8652253.00');
    const b = recalcProjects([{ project, setting, clusters: [{ ...base, calc: {} as never }], total: {} as never }], {
      interestRate: '0.1',
      retensiAsCost: false,
    });
    expect(b.projects[0].total.profit).toBe('961865.20');
  });

  it('override project tidak terpengaruh preview global', () => {
    const r = recalcProjects(
      [{ project, setting: { ...setting, overridden: ['interestRate'] }, clusters: [{ ...base, calc: {} as never }], total: {} as never }],
      { interestRate: '0.5', retensiAsCost: true },
    );
    expect(r.projects[0].total.interest).toBe('865225.30');
  });
});
