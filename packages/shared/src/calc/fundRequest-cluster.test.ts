import { describe, expect, it } from 'vitest';
import { D, moneyStr, sum } from './decimal';
import { computeFundRequest, frDefaultPcts, type FrLineInput } from './fundRequest';

// Contoh: 3 pos, Marketing over 400.000 → ruang cluster berkurang
const base: Omit<FrLineInput, 'pctCair'>[] = [
  { code: 'SUBCON', budgetAmount: '10000000', realisasiTanpaPengajuan: '4000000' }, // sisa 6.000.000
  { code: 'OPS_KANTOR', budgetAmount: '1000000', realisasiTanpaPengajuan: '0' }, // sisa 1.000.000
  { code: 'MARKETING', budgetAmount: '500000', realisasiTanpaPengajuan: '900000' }, // over 400.000
];

describe('Acuan U — batas cluster: over di satu pos mengurangi ruang pengajuan', () => {
  it('sisaCluster = Σ ROUND(budget) − Σ terpakai = 11.500.000 − 4.900.000 = 6.600.000 (bukan 7.000.000)', () => {
    const pcts = frDefaultPcts(base);
    const fr = computeFundRequest('100000000', base.map((b) => ({ ...b, pctCair: pcts[b.code] })));
    expect(moneyStr(fr.cluster.sisaCluster)).toBe('6600000.00');
    expect(moneyStr(fr.cluster.overPos)).toBe('400000.00');
    expect(moneyStr(fr.total.sisaTersedia)).toBe('7000000.00');
    // default diskalakan proporsional: 6.000.000 × 6,6/7 = 5.657.142 (+receh), 1.000.000 × 6,6/7 = 942.857
    expect(moneyStr(fr.total.diajukan)).toBe('6600000.00');
    expect(fr.lines.map((l) => moneyStr(l.diajukan))).toEqual(['5657143.00', '942857.00', '0.00']);
    expect(fr.cluster.exceeded).toBe(false);
    expect(fr.overBudgetCodes).toEqual([]);
  });

  it('PM boleh mengubah per pos selama total ≤ sisa cluster; melebihi → exceeded', () => {
    const ok = computeFundRequest('1', base.map((b) => ({ ...b, pctCair: b.code === 'SUBCON' ? '0.6' : b.code === 'OPS_KANTOR' ? '0.6' : '0' })));
    expect(moneyStr(ok.total.diajukan)).toBe('6600000.00');
    expect(ok.cluster.exceeded).toBe(false);
    const bad = computeFundRequest('1', base.map((b) => ({ ...b, pctCair: b.code === 'SUBCON' ? '0.6' : b.code === 'OPS_KANTOR' ? '1' : '0' })));
    expect(moneyStr(bad.total.diajukan)).toBe('7000000.00');
    expect(bad.cluster.exceeded).toBe(true);
    expect(bad.overBudgetCodes).toEqual([]); // per pos masih aman — yang dilanggar batas cluster
  });

  it('tanpa pos over: batas cluster = Σ sisa pos, default tidak diskalakan', () => {
    const noOver = base.filter((b) => b.code !== 'MARKETING');
    const pcts = frDefaultPcts(noOver);
    expect(pcts.SUBCON.toString()).toBe('0.6');
    const fr = computeFundRequest('1', noOver.map((b) => ({ ...b, pctCair: pcts[b.code] })));
    expect(moneyStr(fr.cluster.sisaCluster)).toBe(moneyStr(sum(fr.lines.map((l) => l.sisaTersedia))));
    expect(fr.cluster.exceeded).toBe(false);
  });

  it('acuan A tetap: 100% tanpa realisasi tidak dipotong batas cluster', () => {
    const fr = computeFundRequest('1', [
      { code: 'SUBCON', budgetAmount: '100.4', pctCair: '1' },
      { code: 'OPS_KANTOR', budgetAmount: '100.4', pctCair: '1' },
    ]);
    expect(moneyStr(fr.total.diajukan)).toBe('200.00');
    expect(fr.cluster.exceeded).toBe(false);
    expect(new D(fr.cluster.budget).toString()).toBe('200');
  });
});
