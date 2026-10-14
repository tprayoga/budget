import { describe, expect, it } from 'vitest';
import { calcCluster } from './budget';
import { moneyStr } from './decimal';
import { calcRealizedProfit, matchReferenceToTermin, paymentDeduction, terminTax } from './realization';

describe('Acuan Q — PPN pada termin klien (Fase 2.4)', () => {
  const sinagar = terminTax({ amount: '18500000', ppnRate: '0.11', pphRate: '0.0265' });

  it('Sinagar permit termin 1: DPP 18.500.000 + PPN 2.035.000 − PPh 490.250 = net 20.044.750', () => {
    expect(moneyStr(sinagar.ppn)).toBe('2035000.00');
    expect(moneyStr(sinagar.invoiceTotal)).toBe('20535000.00');
    expect(moneyStr(sinagar.pph)).toBe('490250.00');
    expect(moneyStr(sinagar.expectedNet)).toBe('20044750.00');
  });

  it('PAJAK otomatis = DPP + PPN − diterima = 490.250; PPN titipan 2.035.000 bukan pendapatan', () => {
    expect(moneyStr(paymentDeduction(sinagar.invoiceTotal, '20044750'))).toBe('490250.00');
    const p = calcRealizedProfit([{ status: 'PAID', amount: '18500000', paidAmount: '20044750', ppnRate: '0.11' }], '490250');
    expect(moneyStr(p.pembayaranBruto)).toBe('18500000.00');
    expect(moneyStr(p.ppnTitipan)).toBe('2035000.00');
    expect(moneyStr(p.kasDiterima)).toBe('20044750.00');
    // profit = DPP − PPh (PPN tidak menambah/mengurangi profit)
    expect(moneyStr(p.profitRealisasi)).toBe('18009750.00');
  });

  it('pencocokan referensi: toleransi ±Rp10, ganda → pilih nomor termin sama, tetap ganda → tidak cocok', () => {
    const t = [
      { id: 'a', termin: 1, expectedNet: '20044750' },
      { id: 'b', termin: 2, expectedNet: '20044750' },
      { id: 'c', termin: 3, expectedNet: '1000000' },
    ];
    expect(matchReferenceToTermin({ netAmount: '1000009' }, t).match?.id).toBe('c');
    expect(matchReferenceToTermin({ netAmount: '1000011' }, t).match).toBeNull();
    expect(matchReferenceToTermin({ netAmount: '20044750', termin: 2 }, t).match?.id).toBe('b');
    expect(matchReferenceToTermin({ netAmount: '20044750', termin: null }, t)).toEqual({ match: null, ambiguous: true });
    expect(matchReferenceToTermin({ netAmount: null }, t).match).toBeNull();
    // CCSI 30/30/30 dari PO yang sama, referensi tanpa nomor termin → termin terkecil
    const same = [3, 1, 2].map((n) => ({ id: `t${n}`, termin: n, expectedNet: '16325968.80', group: 'po-kal' }));
    expect(matchReferenceToTermin({ netAmount: '16325969' }, same).match?.id).toBe('t1');
    expect(matchReferenceToTermin({ netAmount: '16325969' }, [...same, { id: 'x', termin: 1, expectedNet: '16325969', group: 'po-lain' }]).ambiguous).toBe(true);
  });
});

describe('Margin permit hanya PO PERMIT (SND dikeluarkan)', () => {
  it('Kalawiran: PERMIT 10.212.800, SND 4.373.496 di nilaiProyek, margin permit −1.081.510,92', () => {
    const r = calcCluster({
      nilaiPoImpl: '0',
      nilaiPoPermit: '14586296',
      permitPoAmount: '10212800',
      permitCost: '10035446.29',
      pajakRate: '0.025',
      retensiRate: '0',
      interestRate: '0.1',
      retensiAsCost: false,
      lines: [],
    });
    expect(moneyStr(r.nilaiProyek)).toBe('14586296.00');
    expect(moneyStr(r.marginPermit)).toBe('-1081510.92');
  });
});
