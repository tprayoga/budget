import { describe, expect, it } from 'vitest';
import { moneyStr } from './decimal';
import { aggregateFrHistory, computeFrLine, computeFundRequest, frDefaultPctCair, frSisaTersedia } from './fundRequest';

describe('Acuan T — pengajuan memperhitungkan realisasi tanpa pengajuan', () => {
  it('Karondoran permit: budget 11.964.553,71 (ROUND 11.964.554), realisasi permit 11.964.553,71 → sisa 0,29 = habis, % default 0', () => {
    const input = { code: 'PERMIT' as const, budgetAmount: '11964553.71', sudahDicairkanSebelum: '0', sedangDiproses: '0', realisasiTanpaPengajuan: '11964553.71' };
    expect(moneyStr(frSisaTersedia(input))).toBe('0.29');
    expect(frDefaultPctCair(input).toString()).toBe('0');
    const l = computeFrLine({ ...input, pctCair: frDefaultPctCair(input) }, '1');
    expect(l).toMatchObject({ habis: true, overBudget: false });
    expect(moneyStr(l.diajukan)).toBe('0.00');
    expect(moneyStr(l.sudahTerpakai)).toBe('11964553.71');
  });

  it('Marketing over: realisasi 1.647.534 > budget 571.689 → habis (over −1.075.845), diajukan 0 tidak gagal; diajukan > 0 → over budget', () => {
    const input = { code: 'MARKETING' as const, budgetAmount: '571689', realisasiTanpaPengajuan: '1647534' };
    expect(moneyStr(frSisaTersedia(input))).toBe('-1075845.00');
    expect(computeFrLine({ ...input, pctCair: frDefaultPctCair(input) }, '1')).toMatchObject({ habis: true, overBudget: false });
    expect(computeFrLine({ ...input, pctCair: '0.5' }, '1').overBudget).toBe(true);
  });

  it('% default = sisa / budget dibulatkan ke bawah 0,01%; diajukan mencapai sisa (aturan pelunasan)', () => {
    const input = { code: 'SUBCON' as const, budgetAmount: '1000000', realisasiTanpaPengajuan: '333333', sudahDicairkanSebelum: '0', sedangDiproses: '0' };
    expect(frDefaultPctCair(input).toString()).toBe('0.6666');
    const l = computeFrLine({ ...input, pctCair: frDefaultPctCair(input) }, '1');
    expect(moneyStr(l.diajukan)).toBe('666667.00');
    expect(l.penyesuaianPembulatan).toBe(true);
    expect(moneyStr(l.sisaSetelahProses)).toBe('0.00');
    // 50% dari sisa tidak disesuaikan
    const half = computeFrLine({ ...input, pctCair: frDefaultPctCair(input).div(2).toDecimalPlaces(4, 1) }, '1');
    expect(moneyStr(half.diajukan)).toBe('333300.00');
  });

  it('sisa = ROUND(budget) − sudah dicairkan − sedang diproses − realisasi tanpa pengajuan; total sisa tersedia mengabaikan pos over', () => {
    const fr = computeFundRequest('100000000', [
      { code: 'SUBCON', budgetAmount: '10000000', pctCair: '0', sudahDicairkanSebelum: '2000000', sedangDiproses: '1000000', realisasiTanpaPengajuan: '3000000' },
      { code: 'MARKETING', budgetAmount: '500000', pctCair: '0', realisasiTanpaPengajuan: '900000' },
    ]);
    expect(moneyStr(fr.lines[0].sisaTersedia)).toBe('4000000.00');
    expect(moneyStr(fr.total.realisasiTanpaPengajuan)).toBe('3900000.00');
    expect(moneyStr(fr.total.sisaTersedia)).toBe('4000000.00');
    expect(fr.overBudgetCodes).toEqual([]);
  });

  it('terminKe = jumlah DICAIRKAN + terminOffset + 1', () => {
    expect(aggregateFrHistory([{ id: 'a', status: 'DICAIRKAN', lines: [] }], null, 2).terminKe).toBe(4);
    expect(aggregateFrHistory([]).terminKe).toBe(1);
  });
});
