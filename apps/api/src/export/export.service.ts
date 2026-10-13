import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  BUDGET_LABEL,
  BUDGET_LINE_CODES,
  formatTanggal,
  FR_STATUS_LABEL,
  type BudgetLineCode,
  type FrStatus,
} from '@indotek/shared';
import { SHEET_LAYOUT as L } from '@indotek/shared/xlsx';
import { BudgetService } from '../budget/budget.service';
import { FundRequestsService } from '../fund-requests/fund-requests.service';
import type { AuthUser } from '../auth/auth.types';

type ProjectBudget = Awaited<ReturnType<BudgetService['projectBudget']>>;

const RP_FMT = '#,##0;[Red]-#,##0';
const PCT_FMT = '0.00%;[Red]-0.00%';
const INPUT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } };
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));

function col(c: number): string {
  let s = '';
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Export budget dengan layout yang sama seperti file contoh (sheet Rekap + sheet per project),
 * lengkap dengan formula Excel. Mode PCT → sel Rp berisi formula; mode RP → angka langsung,
 * sehingga file hasil export bisa di-import ulang tanpa perubahan.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly budget: BudgetService,
    private readonly frs: FundRequestsService,
  ) {}

  async budgetWorkbook(user: AuthUser, projectIds: string[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Indotek Project Budget System';
    wb.created = new Date();
    const global = await this.budget.settingFor(null);
    const budgets: ProjectBudget[] = [];
    for (const id of projectIds) budgets.push(await this.budget.projectBudget(user, id));

    const rekap = wb.addWorksheet('Rekap');
    for (const b of budgets) this.projectSheet(wb, b);
    this.rekapSheet(rekap, budgets, global);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private rekapSheet(ws: ExcelJS.Worksheet, budgets: ProjectBudget[], global: { interestRate: string; retensiAsCost: boolean }) {
    const years = [...new Set(budgets.map((b) => b.project.year))].join(', ');
    ws.getCell('A1').value = `Rekap Budget per Cluster — ${budgets.map((b) => b.project.code).join(', ')} ${years}`;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A3').value = 'ASUMSI (berlaku untuk semua sheet)';
    ws.getCell('A3').font = { bold: true };
    ws.getCell('A4').value = 'Interest Bank (% × Dana Investor)';
    ws.getCell('C4').value = num(global.interestRate);
    ws.getCell('C4').numFmt = '0%';
    ws.getCell('C4').fill = INPUT_FILL;
    ws.getCell('A5').value = 'Retensi dihitung sebagai biaya & masuk Dana Investor?';
    ws.getCell('C5').value = global.retensiAsCost ? 'Ya' : 'Tidak';
    ws.getCell('C5').fill = INPUT_FILL;

    const header = ['Project', 'Cluster / Site', 'Nilai Proyek', 'Dana Investor', 'Interest Bank', 'Outflow', 'Profit', 'Margin'];
    ws.getRow(7).values = header;
    ws.getRow(7).font = { bold: true };
    ws.getRow(7).eachCell((c) => (c.fill = HEAD_FILL));
    let r = 8;
    for (const b of budgets) {
      const sheet = `'${b.project.code}'`;
      const write = (label: string, nameRef: string, rpCol: string, calc: ProjectBudget['total'], isTotal: boolean) => {
        const row = ws.getRow(r);
        row.getCell(1).value = b.project.code;
        row.getCell(2).value = { formula: `${sheet}!${nameRef}`, result: label };
        const refs: [number, number, string][] = [
          [3, L.rowNilaiProyek, calc.nilaiProyek],
          [4, L.rowDanaInvestor, calc.danaInvestor],
          [5, L.rowInterest, calc.interest],
          [6, L.rowOutflow, calc.outflow],
          [7, L.rowProfit, calc.profit],
        ];
        for (const [c, srcRow, result] of refs) {
          row.getCell(c).value = { formula: `${sheet}!${rpCol}${srcRow}`, result: num(result) };
          row.getCell(c).numFmt = RP_FMT;
        }
        row.getCell(8).value = { formula: `IF(C${r}=0,0,G${r}/C${r})`, result: num(calc.margin) };
        row.getCell(8).numFmt = PCT_FMT;
        if (isTotal) {
          row.font = { bold: true };
          row.eachCell((c) => (c.fill = TOTAL_FILL));
        }
        r++;
      };
      write(`TOTAL ${b.project.code}`, 'B1', 'C', b.total, true);
      b.clusters.forEach((c, i) => write(c.name, `${col(L.firstClusterCol + i * 2)}1`, col(L.firstClusterCol + i * 2 + 1), c.calc, false));
    }
    ws.columns.forEach((c, i) => (c.width = [12, 48, 18, 18, 16, 18, 16, 10][i] ?? 14));
    ws.views = [{ state: 'frozen', ySplit: 7 }];
  }

  private projectSheet(wb: ExcelJS.Workbook, b: ProjectBudget) {
    const ws = wb.addWorksheet(b.project.code);
    const title = `Proyeksi Project ${b.project.code} ${b.project.year}`;
    const lastCol = L.firstClusterCol + b.clusters.length * 2 - 1;
    const lastLetter = col(Math.max(lastCol, L.firstClusterCol + 1));
    // Override setting project ditulis sebagai nilai; selain itu merujuk asumsi di sheet Rekap.
    const interestRef = b.setting.overridden.includes('interestRate') ? null : 'Rekap!$C$4';
    const retensiCond = b.setting.overridden.includes('retensiAsCost')
      ? b.setting.retensiAsCost
        ? 'TRUE'
        : 'FALSE'
      : 'Rekap!$C$5="Ya"';

    const labels: Record<number, string> = {
      [L.rowNilaiPoImpl]: 'Nilai PO Implementasi',
      [L.rowNilaiPoPermit]: 'Nilai PO Permit',
      [L.rowNilaiProyek]: 'Nilai Proyek',
      [L.rowDanaInvestor]: 'DUIT INVESTOR',
      [L.rowPermit]: 'Biaya Permit',
      [L.rowInterest]: 'Interest Bank',
      [L.rowPajak]: 'Pajak',
      [L.rowRetensi]: 'Retensi',
      [L.rowCostHeader]: 'COST PROJECT',
      [L.rowOutflow]: 'Outflow',
      [L.rowProfit]: 'Profit',
    };
    for (const code of BUDGET_LINE_CODES) labels[L.lineRows[code]] = BUDGET_LABEL[code];
    ws.getCell(1, 1).value = title;
    ws.getCell(2, 1).value = title;
    ws.getCell(3, 1).value = title;
    for (const [row, label] of Object.entries(labels)) ws.getCell(Number(row), 1).value = label;

    // Kolom TOTAL (B = %, C = Rp)
    ws.getCell(1, 2).value = `TOTAL ${b.project.code}`;
    ws.getCell(1, 3).value = `TOTAL ${b.project.code}`;
    ws.getCell(3, 2).value = '%';
    ws.getCell(3, 3).value = 'Rp';
    const t = b.total;
    const totalRp: Record<number, string> = {
      [L.rowNilaiPoImpl]: t.nilaiPoImpl,
      [L.rowNilaiPoPermit]: t.nilaiPoPermit,
      [L.rowNilaiProyek]: t.nilaiProyek,
      [L.rowDanaInvestor]: t.danaInvestor,
      [L.rowPermit]: t.permit.amount,
      [L.rowInterest]: t.interest,
      [L.rowPajak]: t.pajak.amount,
      [L.rowRetensi]: t.retensi.amount,
      [L.rowOutflow]: t.outflow,
      [L.rowProfit]: t.profit,
    };
    for (const code of BUDGET_LINE_CODES) totalRp[L.lineRows[code]] = t.lines[code].amount;
    const sumif = (row: number) => `SUMIF($D$3:$${lastLetter}$3,"Rp",$D${row}:$${lastLetter}${row})`;
    for (const [row, result] of Object.entries(totalRp)) {
      const cell = ws.getCell(Number(row), 3);
      cell.value = { formula: sumif(Number(row)), result: num(result) };
      cell.numFmt = RP_FMT;
    }
    const totalPct = (row: number, base: number, result: string) => {
      const cell = ws.getCell(row, 2);
      cell.value = { formula: `IF(C${base}=0,0,C${row}/C${base})`, result: num(result) };
      cell.numFmt = PCT_FMT;
    };
    totalPct(L.rowDanaInvestor, L.rowNilaiProyek, t.danaInvestor === '0.00' ? '0' : String(Number(t.danaInvestor) / (Number(t.nilaiProyek) || 1)));
    for (const code of BUDGET_LINE_CODES) totalPct(L.lineRows[code], L.rowNilaiPoImpl, t.lines[code].pct);
    totalPct(L.rowPermit, L.rowNilaiPoImpl, t.permit.pct);
    totalPct(L.rowPajak, L.rowNilaiProyek, t.pajak.pct);
    totalPct(L.rowRetensi, L.rowNilaiPoImpl, t.retensi.pct);
    totalPct(L.rowOutflow, L.rowNilaiProyek, String(Number(t.outflow) / (Number(t.nilaiProyek) || 1)));
    totalPct(L.rowProfit, L.rowNilaiProyek, t.margin);

    b.clusters.forEach((c, i) => {
      const pc = L.firstClusterCol + i * 2; // kolom %
      const rc = pc + 1; // kolom Rp
      const P = col(pc);
      const R = col(rc);
      const set = (row: number, colNo: number, value: ExcelJS.CellValue, fmt: string, input = false) => {
        const cell = ws.getCell(row, colNo);
        cell.value = value;
        cell.numFmt = fmt;
        if (input) cell.fill = INPUT_FILL;
      };
      const f = (formula: string, result: string | number) => ({ formula, result: typeof result === 'number' ? result : num(result) });
      const calc = c.calc;

      ws.getCell(L.rowName, pc).value = c.name;
      ws.getCell(L.rowName, rc).value = c.name;
      ws.getCell(L.rowInfo, pc).value = c.info ?? '';
      ws.getCell(L.rowInfo, rc).value = c.info ?? '';
      ws.getCell(L.rowHeader, pc).value = '%';
      ws.getCell(L.rowHeader, rc).value = 'Rp';

      set(L.rowNilaiPoImpl, rc, num(c.nilaiPoImpl), RP_FMT, true);
      set(L.rowNilaiPoPermit, rc, num(c.nilaiPoPermit), RP_FMT, true);
      set(L.rowNilaiProyek, rc, f(`${R}${L.rowNilaiPoImpl}+${R}${L.rowNilaiPoPermit}`, calc.nilaiProyek), RP_FMT);

      const costRows = `${R}${L.lineRows.INDIRECT}:${R}${L.lineRows.MARKETING}`;
      set(
        L.rowDanaInvestor,
        rc,
        f(
          `${R}${L.lineRows.SUBCON}+${R}${L.rowPermit}+${R}${L.lineRows.TICKET}+${R}${L.rowPajak}+IF(${retensiCond},${R}${L.rowRetensi},0)+SUM(${costRows})`,
          calc.danaInvestor,
        ),
        RP_FMT,
      );
      set(
        L.rowDanaInvestor,
        pc,
        f(`IF(${R}${L.rowNilaiProyek}=0,0,${R}${L.rowDanaInvestor}/${R}${L.rowNilaiProyek})`, Number(calc.danaInvestor) / (Number(calc.nilaiProyek) || 1)),
        PCT_FMT,
      );

      const line = (code: BudgetLineCode) => {
        const row = L.lineRows[code];
        const l = c.lines.find((x) => x.code === code);
        const lc = calc.lines[code];
        if (l?.mode === 'RP') {
          set(row, pc, f(`IF(${R}$${L.rowNilaiPoImpl}=0,0,${R}${row}/${R}$${L.rowNilaiPoImpl})`, lc.pct), PCT_FMT);
          set(row, rc, num(l.amount), RP_FMT, true);
        } else {
          set(row, pc, num(l?.pct ?? '0'), PCT_FMT, true);
          set(row, rc, f(`${P}${row}*${R}$${L.rowNilaiPoImpl}`, lc.amount), RP_FMT);
        }
      };
      BUDGET_LINE_CODES.forEach(line);

      set(L.rowPermit, pc, f(`IF(${R}$${L.rowNilaiPoPermit}=0,0,${R}${L.rowPermit}/${R}$${L.rowNilaiPoPermit})`, calc.permit.pct), PCT_FMT);
      set(L.rowPermit, rc, num(c.permitCost), RP_FMT, true);
      set(L.rowInterest, pc, interestRef ? f(interestRef, b.setting.interestRate) : num(b.setting.interestRate), PCT_FMT);
      set(L.rowInterest, rc, f(`${P}${L.rowInterest}*${R}$${L.rowDanaInvestor}`, calc.interest), RP_FMT);
      set(L.rowPajak, pc, num(c.pajakRate), PCT_FMT, true);
      set(L.rowPajak, rc, f(`${P}${L.rowPajak}*${R}$${L.rowNilaiProyek}`, calc.pajak.amount), RP_FMT);
      set(L.rowRetensi, pc, num(c.retensiRate), PCT_FMT, true);
      set(L.rowRetensi, rc, f(`${P}${L.rowRetensi}*${R}$${L.rowNilaiPoImpl}`, calc.retensi.amount), RP_FMT);
      set(
        L.rowOutflow,
        rc,
        f(`SUM(${R}${L.lineRows.SUBCON}:${R}${L.lineRows.MARKETING})-IF(${retensiCond},0,${R}${L.rowRetensi})`, calc.outflow),
        RP_FMT,
      );
      set(L.rowOutflow, pc, f(`IF(${R}${L.rowNilaiProyek}=0,0,${R}${L.rowOutflow}/${R}${L.rowNilaiProyek})`, Number(calc.outflow) / (Number(calc.nilaiProyek) || 1)), PCT_FMT);
      set(L.rowProfit, rc, f(`${R}${L.rowNilaiProyek}-${R}${L.rowOutflow}`, calc.profit), RP_FMT);
      set(L.rowProfit, pc, f(`IF(${R}${L.rowNilaiProyek}=0,0,${R}${L.rowProfit}/${R}${L.rowNilaiProyek})`, calc.margin), PCT_FMT);
      ws.getColumn(pc).width = 9;
      ws.getColumn(rc).width = 16;
    });

    ws.getColumn(1).width = 38;
    ws.getColumn(2).width = 9;
    ws.getColumn(3).width = 18;
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).eachCell((c) => (c.fill = HEAD_FILL));
    for (const r of [L.rowNilaiProyek, L.rowDanaInvestor, L.rowOutflow, L.rowProfit, L.rowCostHeader]) ws.getRow(r).font = { bold: true };
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 3 }];
    const notes = [
      'Catatan:',
      '• Sel kuning = input. Mode % → sel Rp berisi formula; mode Rp → angka langsung (dipakai saat import ulang).',
      '• Interest Bank = (% di Rekap!C4) × Dana Investor. Retensi masuk biaya/Dana Investor atau tidak diatur di Rekap!C5.',
      '• Pajak dihitung dari Nilai Proyek; Retensi & Cost Project dihitung dari Nilai PO Implementasi.',
      `• Diekspor dari Indotek Project Budget System pada ${formatTanggal(new Date())}.`,
    ];
    notes.forEach((n, i) => (ws.getCell(L.rowProfit + 2 + i, 1).value = n));
  }

  async fundRequestsWorkbook(user: AuthUser, q: { status?: FrStatus; projectId?: string; clusterId?: string }) {
    const rows = await this.frs.list(user, q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Pengajuan Dana');
    ws.columns = [
      { header: 'No', key: 'no', width: 5 },
      { header: 'Nomor', key: 'label', width: 24 },
      { header: 'Tanggal', key: 'tanggal', width: 18 },
      { header: 'Project', key: 'project', width: 12 },
      { header: 'Cluster', key: 'cluster', width: 44 },
      { header: 'Termin', key: 'termin', width: 8 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Total Diajukan (Rp)', key: 'total', width: 20 },
      { header: 'Diajukan Oleh', key: 'oleh', width: 24 },
      { header: 'Terakhir Diubah', key: 'updated', width: 18 },
    ];
    rows.forEach((f, i) =>
      ws.addRow({
        no: i + 1,
        label: f.label,
        tanggal: formatTanggal(f.tanggal),
        project: f.project.code,
        cluster: f.cluster.name,
        termin: f.terminKe,
        status: FR_STATUS_LABEL[f.status],
        total: num(f.totalDiajukan),
        oleh: f.diajukanOleh.name,
        updated: formatTanggal(f.updatedAt),
      }),
    );
    ws.getColumn('total').numFmt = RP_FMT;
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).eachCell((c) => (c.fill = HEAD_FILL));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (rows.length) {
      const last = rows.length + 1;
      const totalRow = ws.addRow({ cluster: 'TOTAL', total: { formula: `SUM(H2:H${last})`, result: rows.reduce((a, f) => a + num(f.totalDiajukan), 0) } });
      totalRow.font = { bold: true };
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
