import { describe, expect, it } from 'vitest';
import { allocate, allocateGroup } from './allocation';
import { moneyStr, sum } from './decimal';
import { calcFundUsage, calcRealization, calcRealizedProfit, paymentDeduction, realizationLevel } from './realization';
import { addWorkingDays, calcDueDate, generateTermins, isoDay } from './termin';

const EVANTAMA = [
  { clusterId: 'SINAGAR', nilaiPoImpl: '108940677' },
  { clusterId: 'RW08', nilaiPoImpl: '34882758' },
  { clusterId: 'RW04', nilaiPoImpl: '41631388' },
];
/** Item OPS Evantama di sheet EVANTAMA D49:D60 (Σ = 10.735.600). */
const OPS_ITEMS = ['973100', '810000', '335000', '948500', '550000', '523000', '815000', '800000', '1470000', '629000', '2132000', '750000'];

describe('Acceptance — alokasi OPS Evantama', () => {
  it('EQUAL 10.735.600 → 3.578.533,33 / 3.578.533,33 / 3.578.533,34', () => {
    expect(allocate('10735600', EVANTAMA, 'EQUAL').map((l) => moneyStr(l.amount))).toEqual([
      '3578533.33',
      '3578533.33',
      '3578533.34',
    ]);
  });

  it('EQUAL per item (12 expense satu grup) tetap menghasilkan total per cluster yang sama', () => {
    expect(moneyStr(sum(OPS_ITEMS))).toBe('10735600.00');
    const lines = allocateGroup(OPS_ITEMS, EVANTAMA, 'EQUAL');
    lines.forEach((item, i) => expect(moneyStr(sum(item.map((l) => l.amount)))).toBe(moneyStr(OPS_ITEMS[i])));
    const perCluster = EVANTAMA.map((_, c) => moneyStr(sum(lines.map((item) => item[c].amount))));
    expect(perCluster).toEqual(['3578533.33', '3578533.33', '3578533.34']);
  });

  it('PRO_RATA_PO memakai nilaiPoImpl (108.940.677 / 34.882.758 / 41.631.388)', () => {
    const r = allocate('10735600', EVANTAMA, 'PRO_RATA_PO');
    expect(r.map((l) => moneyStr(l.amount))).toEqual(['6306352.74', '2019291.44', '2409955.82']);
    expect(moneyStr(sum(r.map((l) => l.amount)))).toBe('10735600.00');
  });

  it('MANUAL wajib berjumlah sama dengan nominal', () => {
    expect(() => allocate('100', [{ clusterId: 'a', manualAmount: '60' }, { clusterId: 'b', manualAmount: '30' }], 'MANUAL')).toThrow();
    const ok = allocate('100', [{ clusterId: 'a', manualAmount: '60' }, { clusterId: 'b', manualAmount: '40' }], 'MANUAL');
    expect(ok[1].pct.toString()).toBe('0.4');
  });

  it('satu cluster → 100%', () => {
    expect(allocate('18293488', [{ clusterId: 'GEMPOL' }], 'EQUAL')[0].amount.toString()).toBe('18293488');
  });
});

describe('Realisasi vs budget', () => {
  it('level: kuning > 80%, merah > 100%', () => {
    expect(realizationLevel('100', '80', '0.8')).toBe('ok');
    expect(realizationLevel('100', '80.01', '0.8')).toBe('warn');
    expect(realizationLevel('100', '100', '0.8')).toBe('warn');
    expect(realizationLevel('100', '100.01', '0.8')).toBe('over');
    expect(realizationLevel('0', '1', '0.8')).toBe('over');
    expect(realizationLevel('0', '0', '0.8')).toBe('ok');
  });

  it('tabel per pos + total; pending tidak dihitung', () => {
    const r = calcRealization({ SUBCON: '34003540' }, { SUBCON: '18293488' }, '0.8', { OPS_KANTOR: '500000' });
    const subcon = r.rows.find((x) => x.code === 'SUBCON')!;
    expect(moneyStr(subcon.sisa)).toBe('15710052.00');
    expect(subcon.level).toBe('ok');
    expect(r.rows.find((x) => x.code === 'OPS_KANTOR')!.realisasi.toString()).toBe('0');
    expect(moneyStr(r.total.menungguVerifikasi)).toBe('500000.00');
  });

  it('profit realisasi = bruto PAID − realisasi; kas diterima terpisah', () => {
    const p = calcRealizedProfit(
      [
        { status: 'PAID', amount: '10000000', paidAmount: '9735000' },
        { status: 'INVOICED', amount: '5000000', paidAmount: null },
      ],
      '6000000',
    );
    expect(moneyStr(p.pembayaranBruto)).toBe('10000000.00');
    expect(moneyStr(p.kasDiterima)).toBe('9735000.00');
    expect(moneyStr(p.profitRealisasi)).toBe('4000000.00');
  });

  it('Acceptance — potongan pembayaran → expense PAJAK', () => {
    expect(paymentDeduction('10000000', '9735000').toString()).toBe('265000');
    expect(paymentDeduction('10000000', '9750000').toString()).toBe('250000');
    expect(paymentDeduction('10000000', '10000000').toString()).toBe('0');
    expect(paymentDeduction('10000000', null).toString()).toBe('0');
  });

  it('dana cair vs realisasi vs sisa di tangan', () => {
    const u = calcFundUsage({ SUBCON: '3476450', PAJAK: '118011' }, { SUBCON: '3000000' });
    expect(moneyStr(u.total.cair)).toBe('3594461.00');
    expect(moneyStr(u.total.sisa)).toBe('594461.00');
  });
});

describe('Termin klien', () => {
  it('ADW 80/10/10', () => {
    const t = generateTermins([{ terminKe: 1, pct: '0.8' }, { terminKe: 2, pct: '0.1' }, { terminKe: 3, pct: '0.1' }], '44741500');
    expect(t.map((x) => moneyStr(x.amount))).toEqual(['35793200.00', '4474150.00', '4474150.00']);
  });

  it('Evantama implementasi 20/30/40/10 (sisa ke termin terakhir) & permit 50/50', () => {
    const t = generateTermins(
      [{ terminKe: 1, pct: '0.2' }, { terminKe: 2, pct: '0.3' }, { terminKe: 3, pct: '0.4' }, { terminKe: 4, pct: '0.1' }],
      '108940677',
    );
    expect(t.map((x) => moneyStr(x.amount))).toEqual(['21788135.40', '32682203.10', '43576270.80', '10894067.70']);
    expect(moneyStr(sum(t.map((x) => x.amount)))).toBe('108940677.00');
    const p = generateTermins([{ terminKe: 1, pct: '0.5' }, { terminKe: 2, pct: '0.5' }], '37000000');
    expect(p.map((x) => moneyStr(x.amount))).toEqual(['18500000.00', '18500000.00']);
  });

  it('aging 30 hari kalender', () => {
    expect(isoDay(calcDueDate('2026-09-16', 30, 'CALENDAR')!)).toBe('2026-10-16');
  });

  it('aging 14 hari kerja melewati Sabtu/Minggu dan hari libur', () => {
    // Senin 14 Sep 2026 + 14 hari kerja = Jumat 2 Okt 2026
    expect(isoDay(addWorkingDays('2026-09-14', 14))).toBe('2026-10-02');
    // libur Kamis 1 Okt → mundur ke Senin 5 Okt
    expect(isoDay(calcDueDate('2026-09-14', 14, 'WORKING', ['2026-10-01'])!)).toBe('2026-10-05');
  });

  it('tanpa aging → null', () => {
    expect(calcDueDate('2026-09-14', null, null)).toBeNull();
  });
});
