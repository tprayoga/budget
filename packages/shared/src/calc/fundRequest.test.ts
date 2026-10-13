import { describe, expect, it } from 'vitest';
import { FR_CODES, type FrCode } from '../enums';
import { calcCluster } from './budget';
import { moneyStr } from './decimal';
import {
  aggregateFrHistory,
  computeFundRequest,
  defaultJustifikasi,
  draftLabel,
  formatFpdNumber,
  frBudgetAmounts,
  type FrHistoryItem,
  type FrLineInput,
} from './fundRequest';
import { terbilang } from './terbilang';
import { wanasari } from '../../test/fixtures';

const calc = calcCluster(wanasari());
const budget = frBudgetAmounts(calc);
/** Snapshot budget disimpan 2 desimal. */
const snapshot = Object.fromEntries(FR_CODES.map((c) => [c, moneyStr(budget[c])])) as Record<FrCode, string>;

function inputs(pctCair: string, hist?: ReturnType<typeof aggregateFrHistory>): FrLineInput[] {
  return FR_CODES.map((code) => ({
    code,
    budgetAmount: snapshot[code],
    pctCair,
    sudahDicairkanSebelum: hist?.sudahDicairkanSebelum[code] ?? 0,
    sedangDiproses: hist?.sedangDiproses[code] ?? 0,
    pctCairSebelumnya: hist?.pctCairSebelumnya[code] ?? 0,
  }));
}

function toHistory(id: string, status: FrHistoryItem['status'], fr: ReturnType<typeof computeFundRequest>): FrHistoryItem {
  return { id, status, lines: fr.lines.map((l) => ({ budgetCode: l.code, diajukan: l.diajukan, pctCair: l.pctCair })) };
}

describe('Acceptance A — form pengajuan 100%', () => {
  const fr = computeFundRequest(calc.nilaiProyek, inputs('1'));
  const line = (c: FrCode) => fr.lines.find((l) => l.code === c)!;

  it('urutan & bagian', () => {
    expect(fr.lines.map((l) => l.code)).toEqual([...FR_CODES]);
    expect(fr.lines.filter((l) => l.section === 'A').map((l) => l.code)).toEqual(['SUBCON', 'PERMIT', 'TICKET', 'PAJAK']);
  });
  it('diajukan = ROUND_HALF_UP(budget × pctCair)', () => {
    expect(line('PAJAK').diajukan.toString()).toBe('236021');
    expect(line('INDIRECT').diajukan.toString()).toBe('94409');
    expect(line('DIRECT').diajukan.toString()).toBe('141613');
  });
  it('subtotal & total', () => {
    expect(fr.subtotalA.budgetAmount.toString()).toBe('7188921.25');
    expect(fr.subtotalA.diajukan.toString()).toBe('7188921');
    expect(fr.subtotalB.budgetAmount.toString()).toBe('519246.75');
    expect(fr.subtotalB.diajukan.toString()).toBe('519249');
    expect(fr.total.budgetAmount.toString()).toBe('7708168');
    expect(fr.total.diajukan.toString()).toBe('7708170');
  });
  it('terbilang TOTAL', () => {
    expect(terbilang(fr.total.diajukan)).toBe('Tujuh juta tujuh ratus delapan ribu seratus tujuh puluh rupiah');
  });
  it('% nilai proyek = budget / nilaiProyek', () => {
    expect(line('PAJAK').pctNilaiProyek.toString()).toBe('0.025');
  });
  it('sisa budget = ROUND(budget) − sudah − diajukan', () => {
    expect(line('PAJAK').sisaBudget.toString()).toBe('0');
    expect(line('INDIRECT').sisaBudget.toString()).toBe('0');
    expect(fr.overBudgetCodes).toEqual([]);
  });
});

describe('Acceptance F — pencairan bertahap 50% + 50%', () => {
  const fr1 = computeFundRequest(calc.nilaiProyek, inputs('0.5', aggregateFrHistory([])));

  it('pengajuan #1: termin 1, total 3.854.083', () => {
    expect(aggregateFrHistory([]).terminKe).toBe(1);
    expect(fr1.total.diajukan.toString()).toBe('3854083');
    expect(fr1.lines.find((l) => l.code === 'PAJAK')!.diajukan.toString()).toBe('118011');
  });

  it('selama #1 diproses: sedangDiproses terisi, pengajuan 100% melanggar validasi', () => {
    const hist = aggregateFrHistory([toHistory('fr1', 'DISETUJUI_DIREKTUR', fr1)]);
    expect(hist.terminKe).toBe(1);
    expect(hist.sudahDicairkanSebelum.SUBCON.toString()).toBe('0');
    expect(hist.sedangDiproses.SUBCON.toString()).toBe('3476450');
    const other = computeFundRequest(calc.nilaiProyek, inputs('1', hist));
    expect(other.overBudgetCodes).toContain('SUBCON');
  });

  it('pengajuan itu sendiri tidak dihitung di sedangDiproses', () => {
    const hist = aggregateFrHistory([toHistory('fr1', 'DIAJUKAN', fr1)], 'fr1');
    expect(hist.sedangDiproses.SUBCON.toString()).toBe('0');
  });

  it('DITOLAK & DRAFT tidak dihitung', () => {
    const hist = aggregateFrHistory([toHistory('a', 'DITOLAK', fr1), toHistory('b', 'DRAFT', fr1)]);
    expect(hist.sedangDiproses.SUBCON.toString()).toBe('0');
    expect(hist.sudahDicairkanSebelum.SUBCON.toString()).toBe('0');
    expect(hist.terminKe).toBe(1);
  });

  describe('#1 DICAIRKAN lalu pengajuan #2 50%', () => {
    const hist = aggregateFrHistory([toHistory('fr1', 'DICAIRKAN', fr1)]);
    const fr2 = computeFundRequest(calc.nilaiProyek, inputs('0.5', hist));
    const line = (c: FrCode) => fr2.lines.find((l) => l.code === c)!;

    it('terminKe 2', () => expect(hist.terminKe).toBe(2));
    it('sudahDicairkanSebelum = diajukan #1', () => {
      expect(line('SUBCON').sudahDicairkanSebelum.toString()).toBe('3476450');
      expect(line('PAJAK').sudahDicairkanSebelum.toString()).toBe('118011');
      expect(line('INDIRECT').sudahDicairkanSebelum.toString()).toBe('47204');
      expect(line('DIRECT').sudahDicairkanSebelum.toString()).toBe('70806');
      expect(fr2.total.sudahDicairkanSebelum.toString()).toBe('3854083');
    });
    it('termin pelunasan: diajukan disesuaikan ke sisa (pembulatan), sisa 0', () => {
      expect(line('PAJAK').diajukan.toString()).toBe('118010');
      expect(line('PAJAK').penyesuaianPembulatan).toBe(true);
      expect(line('INDIRECT').diajukan.toString()).toBe('47205');
      expect(line('DIRECT').diajukan.toString()).toBe('70807');
      expect(line('SUBCON').penyesuaianPembulatan).toBe(false);
      expect(fr2.total.diajukan.toString()).toBe('3854087');
      expect(fr2.lines.every((l) => l.sisaBudget.isZero())).toBe(true);
      expect(fr2.overBudgetCodes).toEqual([]);
      expect(fr1.total.diajukan.plus(fr2.total.diajukan).toString()).toBe('7708170');
    });
    it('pengajuan #3 setelah lunas → over budget', () => {
      const hist3 = aggregateFrHistory([toHistory('fr1', 'DICAIRKAN', fr1), toHistory('fr2', 'DICAIRKAN', fr2)]);
      expect(hist3.terminKe).toBe(3);
      const fr3 = computeFundRequest(calc.nilaiProyek, inputs('0.1', hist3));
      expect(fr3.overBudgetCodes).toContain('SUBCON');
    });
  });
});

describe('Nomor & teks', () => {
  it('FPD/ADW/2026/10/001', () => {
    expect(formatFpdNumber('ADW', new Date('2026-10-13T05:00:00Z'), 1)).toBe('FPD/ADW/2026/10/001');
  });
  it('bulan menurut Asia/Jakarta (31 Okt 20:00 UTC = 1 Nov WIB)', () => {
    expect(formatFpdNumber('ccsi', new Date('2026-10-31T20:00:00Z'), 12)).toBe('FPD/CCSI/2026/11/012');
  });
  it('label draft', () => expect(draftLabel('clx1234abcdef')).toBe('DRAFT-ABCDEF'));
  it('justifikasi default', () => {
    expect(defaultJustifikasi('WANASARI RW 01 SUBANG', 'PT ADW')).toBe(
      'Modal kerja pelaksanaan pekerjaan FTTH WANASARI RW 01 SUBANG untuk PT ADW.',
    );
  });
});
