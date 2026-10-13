import ExcelJS from 'exceljs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { calcCluster, calcProjectTotal } from '../src/calc/budget';
import { D } from '../src/calc/decimal';
import { parseBudgetWorkbook, type ParsedWorkbook } from '../src/xlsx/budgetSheet';

const SAMPLE = path.resolve(__dirname, '../../../docs/samples/Budget_Per_Cluster_ADW_Evantama_CCSI.xlsx');

let parsed: ParsedWorkbook;
beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SAMPLE);
  parsed = parseBudgetWorkbook(wb);
});

function total(code: string, retensiAsCost = true) {
  const p = parsed.projects.find((x) => x.projectCode === code)!;
  return calcProjectTotal(p.clusters.map((c) => calcCluster({ ...c, interestRate: '0.10', retensiAsCost })));
}

const within1 = (actual: InstanceType<typeof D>, expected: string) =>
  expect(actual.minus(expected).abs().lte(1)).toBe(true);

describe('Acceptance C — total project dari file contoh', () => {
  it('membaca 3 sheet project + asumsi Rekap', () => {
    expect(parsed.projects.map((p) => p.projectCode)).toEqual(['ADW', 'EVANTAMA', 'CCSI']);
    expect(parsed.projects.map((p) => p.clusters.length)).toEqual([30, 3, 3]);
    expect(parsed.interestRate).toBe('0.1');
    expect(parsed.retensiAsCost).toBe(true);
    expect(parsed.projects.flatMap((p) => p.warnings)).toEqual([]);
  });

  it('ADW nilaiProyek 716.165.700, profit −7.815.037', () => {
    const t = total('ADW');
    within1(t.nilaiProyek, '716165700');
    within1(t.profit, '-7815037');
  });
  it('EVANTAMA nilaiProyek 236.454.823, profit −12.759.106', () => {
    const t = total('EVANTAMA');
    within1(t.nilaiProyek, '236454823');
    within1(t.profit, '-12759106');
  });
  it('CCSI nilaiProyek 136.073.359, profit −1.871.953', () => {
    const t = total('CCSI');
    within1(t.nilaiProyek, '136073359');
    within1(t.profit, '-1871953');
  });
});

describe('Deteksi mode & metadata saat import', () => {
  it('WANASARI RW 01 SUBANG cocok dengan acceptance A', () => {
    const c = parsed.projects[0].clusters.find((x) => x.name === 'WANASARI RW 01 SUBANG')!;
    expect(c.nilaiPoImpl).toBe('9440850');
    expect(c.lines.find((l) => l.code === 'SUBCON')).toMatchObject({ mode: 'RP', amount: '6952900' });
    expect(c.lines.find((l) => l.code === 'DIRECT')).toMatchObject({ mode: 'PCT', pct: '0.015' });
    expect(c.pajakRate).toBe('0.025');
  });
  it('Evantama Sinagar: permit & pajak 2,65%; OPS_KANTOR mode RP', () => {
    const c = parsed.projects[1].clusters[0];
    expect(c.name).toBe('Cluster Sinagar Tasik');
    expect(c).toMatchObject({ nilaiPoImpl: '108940677', nilaiPoPermit: '37000000', permitCost: '37000000', pajakRate: '0.0265' });
    expect(c.lines.find((l) => l.code === 'OPS_KANTOR')!.mode).toBe('RP');
    expect(c.division).toBeNull();
  });
  it('CCSI: SUBCON mode PCT', () => {
    expect(parsed.projects[2].clusters[0].lines.find((l) => l.code === 'SUBCON')!.mode).toBe('PCT');
  });
  it('ADW: divisi dari baris info', () => {
    const divs = parsed.projects[0].clusters.map((c) => c.division);
    expect(divs.filter((d) => d === 'IBK')).toHaveLength(5);
    expect(divs.filter((d) => d === 'TELCO')).toHaveLength(25);
  });
});
