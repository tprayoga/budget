import ExcelJS from 'exceljs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { allocateGroup } from '../src/calc/allocation';
import { D, moneyStr, sum } from '../src/calc/decimal';
import { clusterNameKey, parseRabWorkbook, type ParsedRab, type RabProjectSheet } from '../src/xlsx/rabSheet';

const RAB = path.resolve(__dirname, '../../../docs/samples/RAB_Project_TELCO_-_IBK_1.sample.xlsx');
let rab: ParsedRab;
const sheet = (name: string) => rab.projects.find((p) => p.sheetName === name)!;
const total = (p: RabProjectSheet, cell: string) => p.totals.find((t) => t.cell === cell)!;

beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RAB);
  rab = parseRabWorkbook(wb);
});

describe('Parser RAB — kelengkapan', () => {
  it('membaca sheet ADW, EVANTAMA, CCSI + buku kas TELCO - OPS', () => {
    expect(rab.projects.map((p) => p.sheetName).sort()).toEqual(['ADW', 'CCSI', 'EVANTAMA']);
    expect(rab.ledgerSheet).toBe('TELCO - OPS');
  });

  it('setiap total di sheet = Σ item hasil parse (tidak ada item terlewat / dobel)', () => {
    let n = 0;
    for (const p of rab.projects) {
      const byKey = new Map(p.items.map((i) => [i.key, i]));
      for (const t of p.totals) {
        n++;
        expect(moneyStr(sum(t.itemKeys.map((k) => byKey.get(k)!.amount)))).toBe(moneyStr(t.value));
      }
    }
    expect(n).toBeGreaterThan(60);
  });
});

describe('Acceptance — Evantama Cluster Sinagar Tasik', () => {
  it('Total Jasa 19.284.060, Total Material 26.353.000, Biaya Permit 37.000.000', () => {
    const p = sheet('EVANTAMA');
    expect(total(p, 'D44')).toMatchObject({ label: 'Total Jasa', value: '19284060', blockTitle: 'Cluster Sinagar Tasik - Implementasi' });
    expect(total(p, 'D45')).toMatchObject({ label: 'Total Material', value: '26353000' });
    expect(total(p, 'D33')).toMatchObject({ label: 'Total Permit', value: '37000000' });
    const items = p.items.filter((i) => i.blockTitle?.startsWith('Cluster Sinagar Tasik'));
    const by = (c: string) => moneyStr(sum(items.filter((i) => i.category === c).map((i) => i.amount)));
    expect(by('SUBCON_JASA')).toBe('19284060.00');
    expect(by('SUBCON_MATERIAL')).toBe('26353000.00');
    expect(by('PERMIT')).toBe('37000000.00');
  });

  it('OPS Evantama: 12 item = 10.735.600, grup "Cluster Sinagar & Kersanegara Tasik", dibagi rata 3 cluster', () => {
    const ops = sheet('EVANTAMA').items.filter((i) => i.section === 'OPS');
    expect(ops).toHaveLength(12);
    expect(new Set(ops.map((i) => i.groupTitle))).toEqual(new Set(['Cluster Sinagar & Kersanegara Tasik']));
    expect(ops.every((i) => i.category === 'OPS' && !i.needsMapping)).toBe(true);
    expect(moneyStr(sum(ops.map((i) => i.amount)))).toBe('10735600.00');
    const lines = allocateGroup(ops.map((i) => i.amount), [{ clusterId: 'S' }, { clusterId: 'R8' }, { clusterId: 'R4' }], 'EQUAL');
    expect([0, 1, 2].map((c) => moneyStr(sum(lines.map((l) => l[c].amount))))).toEqual(['3578533.33', '3578533.33', '3578533.34']);
  });

  it('periode "Juli Week 2" → tanggal 1 Juli + peringatan', () => {
    const d49 = sheet('EVANTAMA').items.find((i) => i.cell === 'D49')!;
    expect(d49).toMatchObject({ date: '2026-07-01', periodText: 'Juli Week 2' });
    expect(d49.warnings[0]).toMatch(/periode/);
  });
});

describe('Acceptance — CCSI Manado', () => {
  it('Total Jasa 36.920.416 (blok site → pemetaan cluster manual)', () => {
    const t = total(sheet('CCSI'), 'D42');
    expect(t).toMatchObject({ label: 'Total Jasa', value: '36920416', blockTitle: 'CCSI - Site Manado' });
    expect(t.itemKeys).toHaveLength(3);
  });

  it('Total Lain-lain & daftar tanpa kategori → perlu dipetakan manual (dengan saran)', () => {
    const p = sheet('CCSI');
    expect(p.items.find((i) => i.cell === 'D36')).toMatchObject({ needsMapping: true, category: null, suggestedCategory: 'PJD' });
    expect(p.items.find((i) => i.cell === 'C54')).toMatchObject({ needsMapping: true, suggestedCategory: 'TICKET' });
  });
});

describe('Acceptance — ADW Gempol Cirebon (kategori dari label)', () => {
  const gempol = () => sheet('ADW').items.filter((i) => i.blockTitle?.startsWith('Gempol Cirebon'));

  it('Total Jasa di sheet 17.682.752', () => {
    expect(total(sheet('ADW'), 'D42')).toMatchObject({ label: 'Total Jasa', value: '17682752' });
  });

  it('SUBCON_JASA 13.339.200, SUBCON_MATERIAL 4.954.288, pos SUBCON 18.293.488', () => {
    const by = (c: string) => moneyStr(sum(gempol().filter((i) => i.category === c).map((i) => i.amount)));
    expect(by('SUBCON_JASA')).toBe('13339200.00');
    expect(by('SUBCON_MATERIAL')).toBe('4954288.00');
    expect(moneyStr(sum(gempol().map((i) => i.amount)))).toBe('18293488.00');
  });

  it('peringatan label ≠ formula total untuk D35 "Term 1 Material 80%"', () => {
    const d35 = gempol().find((i) => i.cell === 'D35')!;
    expect(d35.category).toBe('SUBCON_MATERIAL');
    expect(d35.warnings.join(' ')).toMatch(/≠ formula total/);
  });

  it('label ambigu "Jasa & Material" mengikuti formula total + peringatan', () => {
    const di34 = sheet('ADW').items.find((i) => i.cell === 'DI34')!;
    expect(di34.category).toBe('SUBCON_JASA');
    expect(di34.warnings.join(' ')).toMatch(/lebih dari satu/);
  });

  it('item PJD/Allowance di section "Biaya OPS" ADW → manual', () => {
    const ops = sheet('ADW').items.filter((i) => i.section === 'OPS');
    expect(ops).toHaveLength(4);
    expect(ops.every((i) => i.needsMapping && i.category === null)).toBe(true);
  });

  it('baris ringkasan (formula SUM) tidak dianggap item', () => {
    expect(sheet('ADW').items.find((i) => i.cell === 'C76' || i.cell === 'C77')).toBeUndefined();
  });
});

describe('Buku kas TELCO - OPS (nilai cache IMPORTRANGE)', () => {
  it('290 baris transaksi, header ikut-importrange dilewati', () => {
    expect(rab.ledger).toHaveLength(290);
    expect(rab.ledger[0]).toMatchObject({ date: '2026-03-07', projectLabel: 'EVANTAMA', cashOut: '3060000', cashIn: '0' });
    expect(rab.ledger.some((r) => r.description === 'Description')).toBe(false);
  });

  it('total cash in / cash out', () => {
    const tin = rab.ledger.reduce((a, r) => a.plus(r.cashIn), new D(0));
    const tout = rab.ledger.reduce((a, r) => a.plus(r.cashOut), new D(0));
    expect(tin.toString()).toBe('279226293');
    expect(tout.toString()).toBe('1112046652');
  });
});

describe('Tagihan klien', () => {
  it('invoice Sinagar permit termin 1 Paid', () => {
    const inv = sheet('EVANTAMA').invoices.find((i) => i.invoiceNo === 'I2628-00139')!;
    expect(inv).toMatchObject({ termin: 1, blockTitle: 'Cluster Sinagar Tasik - Permit', paid: true, amount: '20044750' });
  });
});

describe('Pencocokan nama cluster (persis, himpunan kata)', () => {
  it.each([
    ['Cluster Kersanagara Tasik RW 08 - Permit', 'Cluster Kersanagara RW 08 Tasik'],
    ['Gempol Cirebon SPK 01', 'Gempol Cirebon'],
    ['Cluster Sinagar Tasik - Implementasi', 'Cluster Sinagar Tasik'],
    ['Batumpang Rw 5 &  6 Purwakarta', 'Batumpang Rw 5 & 6 Purwakarta'],
  ])('%s ≡ %s', (a, b) => expect(clusterNameKey(a)).toBe(clusterNameKey(b)));

  it('tidak menebak: "CCSI - Site Manado" ≠ nama cluster Manado', () => {
    expect(clusterNameKey('CCSI - Site Manado')).not.toBe(clusterNameKey('Kalawiran Kakas Barat (Manado)'));
  });
});
