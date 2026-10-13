import type { Cell, Workbook, Worksheet } from 'exceljs';
import type { BudgetLineCode, Division, LineMode } from '../enums';
import { D } from '../calc/decimal';

/**
 * Layout sheet project (contoh: docs/samples/Budget_Per_Cluster_ADW_Evantama_CCSI.sample.xlsx):
 * kolom A = label; mulai kolom D tiap cluster 2 kolom (%, Rp).
 * Baris 1 nama cluster (kolom %), 2 info, 3 header "%"/"Rp", 4 Nilai PO Implementasi (Rp),
 * 5 Nilai PO Permit (Rp), 8 Subcon, 9 Permit, 10 Ticket, 12 Pajak (%), 13 Retensi (%), 15–21 cost project.
 */
export const SHEET_LAYOUT = {
  firstClusterCol: 4,
  rowName: 1,
  rowInfo: 2,
  rowHeader: 3,
  rowNilaiPoImpl: 4,
  rowNilaiPoPermit: 5,
  rowNilaiProyek: 6,
  rowDanaInvestor: 7,
  rowPermit: 9,
  rowInterest: 11,
  rowPajak: 12,
  rowRetensi: 13,
  rowCostHeader: 14,
  rowOutflow: 22,
  rowProfit: 23,
  lineRows: {
    SUBCON: 8,
    TICKET: 10,
    INDIRECT: 15,
    DIRECT: 16,
    OPS_KANTOR: 17,
    MOTOR_MOBIL: 18,
    HOMEBASE: 19,
    ALLOWANCE: 20,
    MARKETING: 21,
  } satisfies Record<BudgetLineCode, number>,
} as const;

export interface ParsedLine {
  code: BudgetLineCode;
  mode: LineMode;
  pct: string | null;
  amount: string | null;
}

export interface ParsedCluster {
  /** Urutan kolom di sheet (0-based). */
  index: number;
  column: string;
  name: string;
  info: string | null;
  division: Division | null;
  nilaiPoImpl: string;
  nilaiPoPermit: string;
  permitCost: string;
  pajakRate: string;
  retensiRate: string;
  lines: ParsedLine[];
}

export interface ParsedProjectSheet {
  sheetName: string;
  projectCode: string;
  title: string;
  year: number | null;
  clusters: ParsedCluster[];
  warnings: string[];
}

export interface ParsedWorkbook {
  projects: ParsedProjectSheet[];
  /** Asumsi di sheet Rekap (bila ada). */
  interestRate: string | null;
  retensiAsCost: boolean | null;
  warnings: string[];
}

type Raw = Cell['value'];

function isFormula(v: Raw): boolean {
  return typeof v === 'object' && v !== null && ('formula' in v || 'sharedFormula' in v);
}

/** Nilai efektif sel: hasil formula bila formula; undefined result dianggap kosong. */
function effective(v: Raw): unknown {
  if (isFormula(v)) return (v as { result?: unknown }).result;
  if (typeof v === 'object' && v !== null && 'richText' in v) {
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  }
  return v;
}

function text(v: Raw): string | null {
  const e = effective(v);
  if (e === null || e === undefined) return null;
  const s = String(e).trim();
  return s ? s : null;
}

function num(v: Raw, where: string, warnings: string[]): string {
  const e = effective(v);
  if (e === null || e === undefined || e === '') return '0';
  if (typeof e === 'number') {
    if (!Number.isFinite(e)) {
      warnings.push(`${where}: angka tidak valid`);
      return '0';
    }
    return new D(String(e)).toString();
  }
  if (typeof e === 'object' && e !== null && 'error' in e) {
    warnings.push(`${where}: sel berisi error ${String((e as { error: unknown }).error)}`);
    return '0';
  }
  const s = String(e).trim().replace(/\s/g, '');
  if (/^-?\d+(\.\d+)?$/.test(s)) return new D(s).toString();
  warnings.push(`${where}: "${s}" bukan angka, dianggap 0`);
  return '0';
}

function colLetter(col: number): string {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function isProjectSheet(ws: Worksheet): boolean {
  return String(text(ws.getCell(SHEET_LAYOUT.rowNilaiPoImpl, 1).value) ?? '')
    .toLowerCase()
    .startsWith('nilai po implementasi');
}

export function parseProjectSheet(ws: Worksheet): ParsedProjectSheet {
  const L = SHEET_LAYOUT;
  const warnings: string[] = [];
  const title = text(ws.getCell(1, 1).value) ?? ws.name;
  const yearMatch = title.match(/(20\d{2})/);
  const clusters: ParsedCluster[] = [];
  const maxCol = ws.columnCount;

  for (let c = L.firstClusterCol, idx = 0; c <= maxCol; c += 2) {
    const name = text(ws.getCell(L.rowName, c).value);
    if (!name) continue;
    const rp = c + 1;
    const at = (row: number, col: number) => `${ws.name}!${colLetter(col)}${row}`;
    const info = text(ws.getCell(L.rowInfo, c).value);
    const div = info?.match(/Divisi\s+(IBK|TELCO)/i)?.[1]?.toUpperCase() as Division | undefined;

    const lines: ParsedLine[] = (Object.entries(L.lineRows) as [BudgetLineCode, number][]).map(
      ([code, row]) => {
        const rpCell = ws.getCell(row, rp).value;
        if (isFormula(rpCell)) {
          return { code, mode: 'PCT', pct: num(ws.getCell(row, c).value, at(row, c), warnings), amount: null };
        }
        return { code, mode: 'RP', pct: null, amount: num(rpCell, at(row, rp), warnings) };
      },
    );

    clusters.push({
      index: idx++,
      column: colLetter(c),
      name,
      info,
      division: div ?? null,
      nilaiPoImpl: num(ws.getCell(L.rowNilaiPoImpl, rp).value, at(L.rowNilaiPoImpl, rp), warnings),
      nilaiPoPermit: num(ws.getCell(L.rowNilaiPoPermit, rp).value, at(L.rowNilaiPoPermit, rp), warnings),
      permitCost: num(ws.getCell(L.rowPermit, rp).value, at(L.rowPermit, rp), warnings),
      pajakRate: num(ws.getCell(L.rowPajak, c).value, at(L.rowPajak, c), warnings),
      retensiRate: num(ws.getCell(L.rowRetensi, c).value, at(L.rowRetensi, c), warnings),
      lines,
    });
  }

  return {
    sheetName: ws.name,
    projectCode: ws.name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    title,
    year: yearMatch ? Number(yearMatch[1]) : null,
    clusters,
    warnings,
  };
}

/** Baca asumsi dari sheet Rekap: C4 interest, C5 "Ya"/"Tidak" retensi sebagai biaya. */
function parseRekap(wb: Workbook, warnings: string[]) {
  const ws = wb.getWorksheet('Rekap');
  if (!ws) return { interestRate: null, retensiAsCost: null };
  const ir = effective(ws.getCell('C4').value);
  const ra = text(ws.getCell('C5').value);
  return {
    interestRate: typeof ir === 'number' ? num(ws.getCell('C4').value, 'Rekap!C4', warnings) : null,
    retensiAsCost: ra ? ra.toLowerCase() === 'ya' : null,
  };
}

export function parseBudgetWorkbook(wb: Workbook, sheetNames?: string[]): ParsedWorkbook {
  const warnings: string[] = [];
  const projects = wb.worksheets
    .filter((ws) => (sheetNames ? sheetNames.includes(ws.name) : isProjectSheet(ws)))
    .map(parseProjectSheet);
  return { projects, ...parseRekap(wb, warnings), warnings };
}

/** "… · Implementasi : 22/8/2026" → "2026-08-22" (juga ejaan "Implentasi"/"Implementas"). */
export function parseImplementationDate(info: string | null | undefined): string | null {
  const m = info?.match(/Impl\w*\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
