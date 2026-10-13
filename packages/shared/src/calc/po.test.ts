import { describe, expect, it } from 'vitest';
import { calcCluster, calcPermitMargin } from './budget';
import { moneyStr } from './decimal';
import { derivePoTotals, parsePoNumbers, poAmountError } from './po';
import { wanasari } from '../../test/fixtures';

describe('PO per cluster → nilai turunan', () => {
  it('Σ IMPLEMENTASI + ADDWORK + DEDUCTION; Σ PERMIT + SND; Σ passThroughCost', () => {
    const t = derivePoTotals([
      { kind: 'IMPLEMENTASI', amount: '33650100' },
      { kind: 'ADDWORK', amount: '398300' },
      { kind: 'DEDUCTION', amount: '-730800' },
      { kind: 'PERMIT', amount: '10212800', passThroughCost: '10035446.29' },
      { kind: 'SND', amount: '4373496', passThroughCost: '0' },
    ]);
    expect(t.nilaiPoImpl.toString()).toBe('33317600');
    expect(t.nilaiPoPermit.toString()).toBe('14586296');
    expect(t.permitCost.toString()).toBe('10035446.29');
  });
  it('validasi tanda', () => {
    expect(poAmountError('DEDUCTION', '100')).toMatch(/negatif/);
    expect(poAmountError('ADDWORK', '-1')).toMatch(/negatif/);
    expect(poAmountError('DEDUCTION', '-1')).toBeNull();
  });
  it.each([
    ['Divisi IBK · PO: PO/2026/07774 · Implementasi: 25/05/2026', ['PO/2026/07774'], []],
    ['Divisi TELCO · SPK:01 · PO/2026/09244 · Implementasi : 07/08/2026', ['PO/2026/09244'], []],
    ['Permit PO 665/PERMIT/ENS/0726 · PO Cluster: 754/FTTH/ENS/0826 PO Subfeeder: 978/FTTH/ENS/0926', ['754/FTTH/ENS/0826', '978/FTTH/ENS/0926'], ['665/PERMIT/ENS/0726']],
    ['Divisi TELCO · SPK : 10', [], []],
  ])('nomor PO dari info: %s', (info, impl, permit) => {
    expect(parsePoNumbers(info)).toEqual({ implementasi: impl, permit });
  });
});

describe('Margin permit', () => {
  it('nilaiPoPermit − permitCost − pajak atas permit − interest atas permitCost', () => {
    // Evantama Sinagar: permit 37.000.000 pass-through, pajak 2,65%, interest 10%
    expect(moneyStr(calcPermitMargin({ nilaiPoPermit: '37000000', permitCost: '37000000', pajakRate: '0.0265', interestRate: '0.1' }))).toBe('-4680500.00');
    // CCSI Semarang: 36.000.000 pass-through, pajak 2,5%
    expect(moneyStr(calcPermitMargin({ nilaiPoPermit: '36000000', permitCost: '36000000', pajakRate: '0.025', interestRate: '0.1' }))).toBe('-4500000.00');
  });
  it('ikut di hasil calcCluster; tanpa permit = 0; rumus utama tidak berubah', () => {
    const r = calcCluster(wanasari());
    expect(r.marginPermit.toString()).toBe('0');
    expect(moneyStr(r.profit)).toBe('-76628.30');
  });
});

describe('Acuan default baru (retensiAsCost = false, retensi = piutang)', () => {
  it('WANASARI RW 01 profit 961.865,20', () => {
    expect(moneyStr(calcCluster(wanasari({ retensiAsCost: false })).profit)).toBe('961865.20');
  });
});
