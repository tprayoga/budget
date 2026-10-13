import { describe, expect, it } from 'vitest';
import { calcCluster, calcProjectTotal, clusterResultToDto } from './budget';
import { moneyStr, roundHalfUp } from './decimal';
import { wanasari } from '../../test/fixtures';

describe('Acceptance A — WANASARI RW 01 SUBANG (retensiAsCost = true)', () => {
  const r = calcCluster(wanasari());

  it('nilai proyek & pos utama', () => {
    expect(r.nilaiProyek.toString()).toBe('9440850');
    expect(r.lines.SUBCON.mode).toBe('RP');
    expect(r.lines.SUBCON.amount.toString()).toBe('6952900');
  });
  it('pajak 236.021,25', () => expect(moneyStr(r.pajak.amount)).toBe('236021.25'));
  it('retensi 944.085', () => expect(moneyStr(r.retensi.amount)).toBe('944085.00'));
  it('danaInvestor 8.652.253', () => expect(moneyStr(r.danaInvestor.amount)).toBe('8652253.00'));
  it('interest 865.225,30', () => expect(moneyStr(r.interest.amount)).toBe('865225.30'));
  it('outflow 9.517.478,30', () => expect(moneyStr(r.outflow.amount)).toBe('9517478.30'));
  it('profit −76.628,30', () => expect(moneyStr(r.profit)).toBe('-76628.30'));
  it('margin −0,81%', () => expect(roundHalfUp(r.margin.times(100), 2).toString()).toBe('-0.81'));
  it('pct tampilan mode RP = amount / nilaiPoImpl', () => {
    expect(roundHalfUp(r.lines.SUBCON.pct, 6).toString()).toBe('0.73647');
  });
  it('cost project = jumlah 7 pos', () => expect(moneyStr(r.costProject.amount)).toBe('519246.75'));
});

describe('Acceptance B — retensiAsCost = false', () => {
  const r = calcCluster(wanasari({ retensiAsCost: false }));
  it('danaInvestor 7.708.168', () => expect(moneyStr(r.danaInvestor.amount)).toBe('7708168.00'));
  it('interest 770.816,80', () => expect(moneyStr(r.interest.amount)).toBe('770816.80'));
  it('profit 961.865,20', () => expect(moneyStr(r.profit)).toBe('961865.20'));
  it('retensi tetap dihitung sebagai info', () => expect(moneyStr(r.retensi.amount)).toBe('944085.00'));
});

describe('Acceptance D — Evantama Cluster Sinagar Tasik', () => {
  const r = calcCluster({
    nilaiPoImpl: '108940677',
    nilaiPoPermit: '37000000',
    permitCost: '37000000',
    pajakRate: '0.0265',
    retensiRate: '0.10',
    interestRate: '0.10',
    retensiAsCost: true,
    lines: [],
  });
  it('nilaiProyek 145.940.677', () => expect(r.nilaiProyek.toString()).toBe('145940677'));
  it('pajak 3.867.427,94 (presisi penuh 3.867.427,9405)', () => {
    expect(r.pajak.amount.toString()).toBe('3867427.9405');
    expect(moneyStr(r.pajak.amount)).toBe('3867427.94');
  });
  it('permit pct tampilan = permitCost / nilaiPoPermit = 100%', () => {
    expect(r.permit.pct.toString()).toBe('1');
  });
});

describe('Kasus tepi', () => {
  it('nilaiProyek 0 → margin 0, pct 0', () => {
    const r = calcCluster({ ...wanasari(), nilaiPoImpl: '0' });
    expect(r.margin.toString()).toBe('0');
    expect(r.lines.SUBCON.pct.toString()).toBe('0');
  });
  it('baris yang tidak ada dianggap 0', () => {
    const r = calcCluster({ ...wanasari(), lines: [] });
    expect(r.costProject.amount.toString()).toBe('0');
  });
  it('total project dari nilai presisi penuh, dibulatkan setelah dijumlah', () => {
    // 3 × 0,005 → bila dibulatkan per cluster dulu = 0,03; dari presisi penuh = 0,015 → 0,02
    const one = calcCluster({ ...wanasari(), nilaiPoImpl: '1', pajakRate: '0.005', lines: [], retensiRate: '0' });
    const t = calcProjectTotal([one, one, one]);
    expect(t.pajak.toString()).toBe('0.015');
    expect(moneyStr(t.pajak)).toBe('0.02');
  });
  it('DTO memakai string 2 desimal', () => {
    const dto = clusterResultToDto(calcCluster(wanasari()));
    expect(dto.profit).toBe('-76628.30');
    expect(dto.lines.INDIRECT).toEqual({ mode: 'PCT', amount: '94408.50', pct: '0.01000000' });
  });
});
