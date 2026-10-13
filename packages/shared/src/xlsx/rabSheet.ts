import type { Cell, Workbook, Worksheet } from 'exceljs';
import type { ExpenseCategory } from '../enums';
import { BULAN } from '../format/tanggal';
import { D } from '../calc/decimal';

/**
 * Parser file "RAB Project TELCO - IBK" (contoh: docs/samples/RAB_Project_TELCO_-_IBK_1.sample.xlsx).
 *
 * Layout tiap sheet project tidak seragam, jadi parser TIDAK memakai posisi tetap:
 *  - Blok subcon: dicari sel berlabel "Total Jasa" / "Total Material" / "Total Permit" / "Total" (permit) /
 *    "Total Lain-lain", lalu referensi formulanya diikuti (mis. `D34+D35+D36`, `sum(L35:L37)`, `=D54` → D53)
 *    untuk menemukan item. Kategori item ditentukan LABEL-nya (Jasa/Material/Permit); bila label tidak
 *    menyebut kategori, dipakai kategori total yang mereferensikannya. Label ≠ total → peringatan.
 *  - Section "Biaya OPS" / "Biaya PJD" / daftar "Keterangan": baris item sampai baris "Total".
 *  - Tagihan klien: sel "Term N - <no invoice>" / "INV-…" + nilai, jatuh tempo, status.
 *  - Buku kas (sheet TELCO - OPS): nilai cache hasil IMPORTRANGE, bukan formulanya.
 * Item yang tidak bisa ditentukan kategori/cluster-nya ditandai `needsMapping` — tidak ditebak.
 */

export type RabSection = 'SUBCON' | 'OPS' | 'PJD' | 'LIST';

export interface RabExpenseItem {
  key: string;
  sheet: string;
  cell: string;
  row: number;
  section: RabSection;
  /** Judul blok (sel merge di atas item), mis. "Gempol Cirebon SPK 01". */
  blockTitle: string | null;
  /** Judul grup di dalam section OPS, mis. "Cluster Sinagar & Kersanegara Tasik". */
  groupTitle: string | null;
  label: string;
  /** Tanggal ISO (YYYY-MM-DD) atau null. */
  date: string | null;
  /** Teks periode asli bila tanggal diturunkan dari periode (mis. "Juli Week 2"). */
  periodText: string | null;
  amount: string;
  /** Label total yang mereferensikan item (blok subcon). */
  totalLabels: string[];
  /** Kategori final otomatis; null = perlu dipilih manual. */
  category: ExpenseCategory | null;
  /** Usulan kategori (hanya saran, tidak diterapkan otomatis). */
  suggestedCategory: ExpenseCategory | null;
  needsMapping: boolean;
  warnings: string[];
}

export interface RabTotal {
  sheet: string;
  cell: string;
  label: string;
  blockTitle: string | null;
  /** Nilai cache di sheet. */
  value: string;
  itemKeys: string[];
}

export interface RabInvoice {
  key: string;
  sheet: string;
  cell: string;
  blockTitle: string | null;
  termin: number | null;
  invoiceNo: string;
  /** Nilai di kolom "Outstanding Payment" (sudah dipotong PPh bila ada). */
  amount: string | null;
  dueDate: string | null;
  statusText: string | null;
  paid: boolean;
}

/** Penyesuaian PO (baris "Deduction Termin 1 + Addwork") → ClusterPo ADDWORK / DEDUCTION. */
export interface RabPoAdjustment {
  /** `{sheet}!{cell}` atau `{sheet}!{cell}#n` bila satu sel berisi beberapa suku (mis. `=398300-730800`). */
  key: string;
  sheet: string;
  cell: string;
  blockTitle: string | null;
  kind: 'ADDWORK' | 'DEDUCTION';
  /** Bertanda: ADDWORK positif, DEDUCTION negatif. */
  amount: string;
  /** Rumus/isi sel asal dan rumus baris total, untuk ditampilkan di preview. */
  source: string;
  totalFormula: string | null;
}

export interface RabProjectSheet {
  sheetName: string;
  projectCode: string;
  year: number | null;
  items: RabExpenseItem[];
  totals: RabTotal[];
  invoices: RabInvoice[];
  poAdjustments: RabPoAdjustment[];
  warnings: string[];
}

export interface LedgerRow {
  sheet: string;
  row: number;
  date: string;
  description: string;
  projectLabel: string | null;
  cashAccount: string | null;
  accountName: string | null;
  cashIn: string;
  cashOut: string;
}

export interface ParsedRab {
  projects: RabProjectSheet[];
  ledger: LedgerRow[];
  ledgerSheet: string | null;
}

// ------------------------------------------------------------------ util sel

type Raw = Cell['value'];

function isFormula(v: Raw): boolean {
  return typeof v === 'object' && v !== null && ('formula' in v || 'sharedFormula' in v);
}

/** Teks formula sel; shared formula diterjemahkan oleh ExcelJS (cell.formula). */
function cellFormula(ws: Worksheet, r: number, c: number): string | null {
  const cell = ws.getCell(r, c);
  if (!isFormula(cell.value)) return null;
  return (cell.formula as string | undefined) ?? (cell.value as { formula?: string }).formula ?? '';
}

/** Formula berisi konstanta saja (mis. `=91000+4275000`) → nilai item, bukan ringkasan. */
function isConstantFormula(f: string): boolean {
  return !/[A-Za-z]/.test(f) && !/\d+:\d+/.test(f);
}

function effective(v: Raw): unknown {
  if (isFormula(v)) return (v as { result?: unknown }).result;
  if (typeof v === 'object' && v !== null && 'richText' in v) {
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  }
  return v;
}

function text(ws: Worksheet, r: number, c: number): string | null {
  const e = effective(ws.getCell(r, c).value);
  if (typeof e !== 'string') return null;
  const s = e.replace(/\s+/g, ' ').trim();
  return s || null;
}

function num(ws: Worksheet, r: number, c: number): D | null {
  const e = effective(ws.getCell(r, c).value);
  if (typeof e === 'number' && Number.isFinite(e)) return new D(String(e));
  return null;
}

/** Nilai tanggal dari Date / serial Excel / string ISO. */
function dateOf(e: unknown): string | null {
  if (e instanceof Date && !Number.isNaN(e.getTime())) return e.toISOString().slice(0, 10);
  if (typeof e === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e)) return e.slice(0, 10);
  if (typeof e === 'number' && e > 30000 && e < 80000) {
    const ms = Math.round((e - 25569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function colLetter(col: number): string {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function colIndex(letters: string): number {
  return letters.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
}

const addr = (r: number, c: number) => `${colLetter(c)}${r}`;

/**
 * Referensi sel di formula (tanpa referensi ke sheet lain, tanpa referensi baris penuh).
 * `D34+D35`, `sum(L35:L37)`, `=D54` → daftar [row, col].
 */
export function formulaRefs(formula: string): [number, number][] {
  const cleaned = formula.replace(/"[^"]*"/g, '');
  const out: [number, number][] = [];
  const re = /(^|[^A-Za-z0-9_!$])\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const c1 = colIndex(m[2]);
    const r1 = Number(m[3]);
    if (m[4]) {
      const c2 = colIndex(m[4]);
      const r2 = Number(m[5]);
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push([r, c]);
    } else {
      out.push([r1, c1]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ kategori

/**
 * Kategori subcon dari label item (Jasa / Material / Permit).
 * Label yang menyebut lebih dari satu ("Jasa & Material") dianggap ambigu → null (ikut formula total).
 */
export function subconLabelCategory(label: string): ExpenseCategory | null {
  const hits: ExpenseCategory[] = [];
  if (/permit/i.test(label)) hits.push('PERMIT');
  if (/material/i.test(label)) hits.push('SUBCON_MATERIAL');
  if (/jasa/i.test(label)) hits.push('SUBCON_JASA');
  return hits.length === 1 ? hits[0] : null;
}

function isAmbiguousLabel(label: string): boolean {
  return [/permit/i, /material/i, /jasa/i].filter((re) => re.test(label)).length > 1;
}

/** Usulan kategori dari kata kunci label (hanya saran untuk pemetaan manual). */
export function keywordCategory(label: string): ExpenseCategory | null {
  const s = label.toLowerCase();
  if (/\bpjd\b|perjalanan dinas/.test(s)) return 'PJD';
  if (/allowance|alloawance/.test(s)) return 'PJD';
  if (/tiket|ticket|pesawat/.test(s)) return 'TICKET';
  if (/\bhb\b|homebase/.test(s)) return 'HOMEBASE';
  if (/sewa (motor|mobil)|\bmotor\b|\bmobil\b/.test(s)) return 'MOTOR_MOBIL';
  if (/material/.test(s)) return 'MATERIAL_PEMBELIAN';
  if (/\bops\b|operasional/.test(s)) return 'OPS';
  if (/permit|donasi/.test(s)) return 'PERMIT';
  if (/pajak|pph/.test(s)) return 'PAJAK';
  return null;
}

function totalCategory(label: string): ExpenseCategory | 'PERMIT_IF_LABELS' | null {
  const s = label.toLowerCase();
  if (s === 'total jasa') return 'SUBCON_JASA';
  if (s === 'total material') return 'SUBCON_MATERIAL';
  if (s === 'total permit') return 'PERMIT';
  if (s === 'total') return 'PERMIT_IF_LABELS';
  return null; // Total Lain-lain, dsb.
}

const TOTAL_RE = /^total( jasa| material| permit| lain-lain)?$/i;

// ------------------------------------------------------------------ helper layout

/** Judul blok: sel teks terdekat di atas (kolom label) yang di-merge sampai kolom nilai. */
function blockTitleAbove(ws: Worksheet, row: number, labelCol: number, valueCol: number, maxUp = 40): string | null {
  for (let r = row - 1; r >= Math.max(1, row - maxUp); r--) {
    const t = text(ws, r, labelCol);
    if (t && text(ws, r, valueCol) === t) return t;
  }
  return null;
}

/** Label item: teks terdekat di kiri sel nilai (maks 3 kolom). */
function labelLeft(ws: Worksheet, row: number, col: number): { label: string | null; labelCol: number; date: string | null } {
  let date: string | null = null;
  for (let c = col - 1; c >= Math.max(1, col - 3); c--) {
    const e = effective(ws.getCell(row, c).value);
    const d = dateOf(e);
    if (d && !(typeof e === 'string' && !/^\d{4}-/.test(e))) {
      date ??= d;
      continue;
    }
    const t = text(ws, row, c);
    if (t) return { label: t, labelCol: c, date };
  }
  return { label: null, labelCol: Math.max(1, col - 2), date };
}

function yearOfSheet(ws: Worksheet): number | null {
  for (let r = 1; r <= 3; r++)
    for (let c = 1; c <= 3; c++) {
      const m = text(ws, r, c)?.match(/(20\d{2})/);
      if (m) return Number(m[1]);
    }
  return null;
}

/** "Juli Week 2" / "Agustus Week 2-5" → tanggal 1 bulan tsb. */
function periodToDate(s: string, year: number | null): string | null {
  if (!year) return null;
  const idx = BULAN.findIndex((b) => new RegExp(`\\b${b}\\b`, 'i').test(s));
  if (idx < 0) return null;
  return `${year}-${String(idx + 1).padStart(2, '0')}-01`;
}

// ------------------------------------------------------------------ parser utama

function parseSubconBlocks(ws: Worksheet, items: Map<string, RabExpenseItem>, totals: RabTotal[]) {
  const sheet = ws.name;
  const totalCells: { r: number; c: number; label: string; amountCol: number }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) =>
    row.eachCell({ includeEmpty: false }, (_cell, c) => {
      const t = text(ws, r, c);
      if (!t || !TOTAL_RE.test(t)) return;
      // hindari duplikat sel merge (B44 & C44 "Total Jasa"): ambil kolom pertama
      if (c > 1 && text(ws, r, c - 1) === t) return;
      for (let k = c + 1; k <= c + 3; k++) {
        if (cellFormula(ws, r, k)) {
          totalCells.push({ r, c, label: t, amountCol: k });
          return;
        }
      }
    }),
  );

  for (const tc of totalCells) {
    const f = cellFormula(ws, tc.r, tc.amountCol)!;
    const leafKeys: string[] = [];
    const visit = (r: number, c: number, depth: number) => {
      if (depth > 5) return;
      const n = num(ws, r, c);
      const { label } = labelLeft(ws, r, c);
      const fv = cellFormula(ws, r, c);
      if (label && TOTAL_RE.test(label) && fv) {
        formulaRefs(fv).forEach(([rr, cc]) => visit(rr, cc, depth + 1));
        return;
      }
      if (!n || n.isZero()) return;
      leafKeys.push(`${sheet}!${addr(r, c)}`);
    };
    formulaRefs(f).forEach(([r, c]) => visit(r, c, 0));

    // "Total" polos hanya dipakai untuk blok permit (label item menyebut Permit)
    const cat = totalCategory(tc.label);
    if (cat === 'PERMIT_IF_LABELS') {
      const allPermit = leafKeys.length > 0 && leafKeys.every((k) => {
        const [, a] = k.split('!');
        const m = a.match(/^([A-Z]+)(\d+)$/)!;
        return /permit/i.test(labelLeft(ws, Number(m[2]), colIndex(m[1])).label ?? '');
      });
      if (!allPermit) continue;
    }

    const value = num(ws, tc.r, tc.amountCol);
    totals.push({
      sheet,
      cell: addr(tc.r, tc.amountCol),
      label: tc.label,
      blockTitle: blockTitleAbove(ws, tc.r, tc.c, tc.amountCol),
      value: value ? value.toString() : '0',
      itemKeys: leafKeys,
    });

    for (const key of leafKeys) {
      const a = key.split('!')[1].match(/^([A-Z]+)(\d+)$/)!;
      const c = colIndex(a[1]);
      const r = Number(a[2]);
      const formulaCat: ExpenseCategory | null = cat === 'PERMIT_IF_LABELS' ? 'PERMIT' : cat;
      const existing = items.get(key);
      if (existing) {
        existing.totalLabels.push(tc.label);
        continue;
      }
      const { label, labelCol, date } = labelLeft(ws, r, c);
      const lbl = label ?? '(tanpa label)';
      items.set(key, {
        key,
        sheet,
        cell: addr(r, c),
        row: r,
        section: 'SUBCON',
        blockTitle: blockTitleAbove(ws, r, labelCol, c),
        groupTitle: null,
        label: lbl,
        date,
        periodText: null,
        amount: num(ws, r, c)!.toString(),
        totalLabels: [tc.label],
        category: formulaCat,
        suggestedCategory: null,
        needsMapping: false,
        warnings: [],
      });
    }
  }

  // Kategori final: label menang; konflik dengan total → peringatan / pemetaan manual
  for (const it of items.values()) {
    if (it.section !== 'SUBCON') continue;
    const fromTotals = [...new Set(it.totalLabels.map((t) => {
      const c = totalCategory(t);
      return c === 'PERMIT_IF_LABELS' ? 'PERMIT' : c;
    }))];
    const byLabel = subconLabelCategory(it.label);
    if (byLabel) {
      it.category = byLabel;
      const formulaCat = fromTotals.length === 1 ? fromTotals[0] : null;
      if (formulaCat && formulaCat !== byLabel) {
        it.warnings.push(`Label "${it.label}" ≠ formula total ("${it.totalLabels.join(', ')}"); kategori mengikuti label.`);
      }
    } else if (fromTotals.length === 1 && fromTotals[0]) {
      it.category = fromTotals[0];
      if (isAmbiguousLabel(it.label)) {
        it.warnings.push(`Label "${it.label}" menyebut lebih dari satu kategori; mengikuti formula "${it.totalLabels[0]}".`);
      }
    } else {
      it.category = null;
      it.needsMapping = true;
      it.suggestedCategory = keywordCategory(it.label);
      it.warnings.push(
        fromTotals.length > 1
          ? `Dijumlah ke beberapa total (${it.totalLabels.join(', ')}) — pilih kategori.`
          : `Kategori tidak bisa ditentukan dari "${it.totalLabels.join(', ')}".`,
      );
    }
  }
}

const SECTION_TITLES: Record<string, RabSection> = { 'biaya ops': 'OPS', 'biaya pjd': 'PJD' };

function parseSections(ws: Worksheet, items: Map<string, RabExpenseItem>, year: number | null) {
  const sheet = ws.name;
  const headers: { r: number; labelCol: number; dateCol: number | null; amountCol: number; section: RabSection }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    const cells: { c: number; t: string }[] = [];
    row.eachCell({ includeEmpty: false }, (_cell, c) => {
      const t = text(ws, r, c);
      if (t) cells.push({ c, t: t.toLowerCase() });
    });
    const jumlah = cells.find((x) => x.t === 'jumlah');
    if (!jumlah) return;
    const titled = cells.find((x) => SECTION_TITLES[x.t] && x.c < jumlah.c);
    const ket = cells.find((x) => x.t === 'keterangan' && x.c < jumlah.c);
    const tanggal = cells.find((x) => (x.t === 'tanggal' || x.t === 'bulan') && x.c < jumlah.c);
    if (titled) {
      headers.push({ r, labelCol: titled.c, dateCol: tanggal?.c ?? null, amountCol: jumlah.c, section: SECTION_TITLES[titled.t] });
    } else if (ket) {
      headers.push({ r, labelCol: ket.c, dateCol: tanggal?.c ?? null, amountCol: jumlah.c, section: 'LIST' });
    }
  });

  for (const h of headers) {
    let groupTitle: string | null = null;
    let blank = 0;
    for (let r = h.r + 1; r <= h.r + 60 && blank < 3; r++) {
      const label = text(ws, r, h.labelCol);
      const amount = num(ws, r, h.amountCol);
      if (label && /^(grand )?total\b/i.test(label)) {
        if (h.section !== 'LIST') break;
        continue;
      }
      if (label && text(ws, r, h.amountCol) === label) {
        groupTitle = label; // baris judul grup (merge)
        blank = 0;
        continue;
      }
      if (!amount) {
        blank++;
        continue;
      }
      blank = 0;
      // baris ringkasan (formula yang mereferensikan sel/fungsi) bukan item
      const f = cellFormula(ws, r, h.amountCol);
      if (f !== null && !isConstantFormula(f)) continue;
      if (amount.isZero()) continue;
      const key = `${sheet}!${addr(r, h.amountCol)}`;
      if (items.has(key)) continue; // sudah tercakup blok subcon

      const lbl = label ?? '(tanpa label)';
      let date: string | null = null;
      let periodText: string | null = null;
      const warnings: string[] = [];
      if (h.dateCol) {
        const e = effective(ws.getCell(r, h.dateCol).value);
        date = dateOf(e);
        if (!date && typeof e === 'string' && e.trim()) {
          periodText = e.trim();
          date = periodToDate(periodText, year);
          if (date) warnings.push(`Tanggal diturunkan dari periode "${periodText}" (tanggal 1 bulan tsb).`);
        }
      }

      let category: ExpenseCategory | null = null;
      let needsMapping = false;
      let suggested: ExpenseCategory | null = null;
      const kw = keywordCategory(lbl);
      if (h.section === 'OPS' || h.section === 'PJD') {
        const sectionCat: ExpenseCategory = h.section;
        if (kw && kw !== sectionCat) {
          needsMapping = true;
          suggested = kw;
          warnings.push(`Label "${lbl}" bertentangan dengan section "Biaya ${h.section}" — pilih kategori manual.`);
        } else {
          category = sectionCat;
        }
      } else {
        needsMapping = true;
        suggested = kw;
        warnings.push('Daftar tanpa kategori — pilih kategori manual.');
      }

      items.set(key, {
        key,
        sheet,
        cell: addr(r, h.amountCol),
        row: r,
        section: h.section,
        blockTitle: blockTitleAbove(ws, h.r + 1, h.labelCol, h.amountCol, 3) ?? null,
        groupTitle,
        label: lbl,
        date,
        periodText,
        amount: amount.toString(),
        totalLabels: [],
        category,
        suggestedCategory: suggested,
        needsMapping,
        warnings,
      });
    }
  }
}

const INVOICE_RE = /^(?:term\s*(\d+)\s*-\s*)?((?:INV[-\w/]+)|(?:I\d{4}-\d{3,}))$/i;

function parseInvoices(ws: Worksheet): RabInvoice[] {
  const out: RabInvoice[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) =>
    row.eachCell({ includeEmpty: false }, (_cell, c) => {
      const t = text(ws, r, c);
      const m = t?.match(INVOICE_RE);
      if (!m) return;
      let amount: string | null = null;
      let dueDate: string | null = null;
      let statusText: string | null = null;
      for (let k = c + 1; k <= c + 3; k++) {
        const e = effective(ws.getCell(r, k).value);
        if (amount === null && typeof e === 'number') amount = new D(String(e)).toString();
        else if (!dueDate && dateOf(e) && !(typeof e === 'number')) dueDate = dateOf(e);
        else if (typeof e === 'string' && /paid/i.test(e)) statusText = e.trim();
      }
      out.push({
        key: `${ws.name}!${addr(r, c)}`,
        sheet: ws.name,
        cell: addr(r, c),
        blockTitle: blockTitleAbove(ws, r, c, c + 1),
        termin: m[1] ? Number(m[1]) : null,
        invoiceNo: m[2],
        amount,
        dueDate,
        statusText,
        paid: !!statusText && /^paid$/i.test(statusText),
      });
    }),
  );
  return out;
}

const LEDGER_HEADERS = ['date', 'description', 'project', 'cash in', 'cash out'];

/** Buku kas: baris header berisi Date / Description / Project / Cash In / Cash Out. Nilai = cache. */
export function parseLedgerSheet(ws: Worksheet): LedgerRow[] | null {
  let header: { r: number; cols: Record<string, number> } | null = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 40) && !header; r++) {
    const cols: Record<string, number> = {};
    for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
      const t = text(ws, r, c)?.toLowerCase();
      if (t && !(t in cols)) cols[t] = c;
    }
    if (LEDGER_HEADERS.every((h) => h in cols)) header = { r, cols };
  }
  if (!header) return null;
  const { cols } = header;
  const cashCol = cols['cash/bank'] ?? null;
  const accCol = cols['account name'] ?? null;
  const out: LedgerRow[] = [];
  for (let r = header.r + 1; r <= ws.rowCount; r++) {
    const date = dateOf(effective(ws.getCell(r, cols['date']).value));
    const description = text(ws, r, cols['description']);
    if (!date || !description) continue;
    out.push({
      sheet: ws.name,
      row: r,
      date,
      description,
      projectLabel: text(ws, r, cols['project']),
      cashAccount: cashCol ? text(ws, r, cashCol) : null,
      accountName: accCol ? text(ws, r, accCol) : null,
      cashIn: (num(ws, r, cols['cash in']) ?? new D(0)).toString(),
      cashOut: (num(ws, r, cols['cash out']) ?? new D(0)).toString(),
    });
  }
  return out;
}

export function parseRabProjectSheet(ws: Worksheet): RabProjectSheet {
  const items = new Map<string, RabExpenseItem>();
  const totals: RabTotal[] = [];
  const year = yearOfSheet(ws);
  parseSubconBlocks(ws, items, totals);
  parseSections(ws, items, year);
  const list = [...items.values()].sort((a, b) => a.row - b.row || a.cell.localeCompare(b.cell));
  return {
    sheetName: ws.name,
    projectCode: ws.name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    year,
    items: list,
    totals,
    invoices: parseInvoices(ws),
    poAdjustments: parsePoAdjustments(ws),
    warnings: [],
  };
}

const ADJ_LABEL_RE = /deduction|addwork/i;

/**
 * Baris penyesuaian PO (kolom A "Deduction Termin 1 + Addwork"), di kolom Realisasi tiap blok.
 * Tanda ditentukan dari rumus baris "Total after deduction" di bawahnya: `X9+X10` → apa adanya, `X9-X10` → dibalik.
 * Sel berumus konstanta (`=398300-730800`) dipecah per suku: suku positif = ADDWORK, negatif = DEDUCTION.
 * Judul blok = baris judul (kolom A berawalan "Proyeksi Project", default baris 2) pada kolom yang sama.
 */
export function parsePoAdjustments(ws: Worksheet): RabPoAdjustment[] {
  let adjRow = 0;
  let titleRow = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
    const a = text(ws, r, 1);
    if (!a) continue;
    if (!titleRow && r < 6 && /^proyeksi project/i.test(a)) titleRow = r;
    if (ADJ_LABEL_RE.test(a) && !/total/i.test(a)) {
      adjRow = r;
      break;
    }
  }
  if (!adjRow) return [];
  const out: RabPoAdjustment[] = [];
  ws.getRow(adjRow).eachCell({ includeEmpty: false }, (cell, c) => {
    if (c === 1) return;
    const raw = cell.value;
    const f = cellFormula(ws, adjRow, c);
    const totalF = cellFormula(ws, adjRow + 1, c);
    const col = colLetter(c);
    const negate = !!totalF && new RegExp(`-\\s*\\$?${col}\\$?${adjRow}\\b`, 'i').test(totalF);
    let terms: D[];
    if (f !== null && isConstantFormula(f)) {
      terms = (f.replace(/^=/, '').replace(/\s+/g, '').match(/[+-]?\d+(?:\.\d+)?/g) ?? []).map((t) => new D(t));
    } else {
      const v = num(ws, adjRow, c);
      if (!v) return;
      terms = [v];
    }
    terms = terms.map((t) => (negate ? t.neg() : t)).filter((t) => !t.isZero());
    const title = text(ws, titleRow || 2, c);
    terms.forEach((t, i) =>
      out.push({
        key: `${ws.name}!${addr(adjRow, c)}${terms.length > 1 ? `#${i + 1}` : ''}`,
        sheet: ws.name,
        cell: addr(adjRow, c),
        blockTitle: title,
        kind: t.isNegative() ? 'DEDUCTION' : 'ADDWORK',
        amount: t.toString(),
        source: f !== null ? `=${f.replace(/^=/, '')}` : String(raw),
        totalFormula: totalF ? `=${totalF.replace(/^=/, '')}` : null,
      }),
    );
  });
  return out;
}

/**
 * Parse workbook RAB. `projectSheets` = nama sheet project yang dibaca (default: ADW, EVANTAMA, CCSI bila ada).
 */
export function parseRabWorkbook(wb: Workbook, projectSheets?: string[]): ParsedRab {
  const names = projectSheets ?? wb.worksheets.map((w) => w.name).filter((n) => ['ADW', 'EVANTAMA', 'CCSI'].includes(n.trim().toUpperCase()));
  const projects = names
    .map((n) => wb.getWorksheet(n))
    .filter((w): w is Worksheet => !!w)
    .map(parseRabProjectSheet);
  let ledger: LedgerRow[] = [];
  let ledgerSheet: string | null = null;
  for (const ws of wb.worksheets) {
    if (names.includes(ws.name)) continue;
    const rows = parseLedgerSheet(ws);
    if (rows?.length) {
      ledger = rows;
      ledgerSheet = ws.name;
      break;
    }
  }
  return { projects, ledger, ledgerSheet };
}

/** Normalisasi nama blok/cluster untuk pencocokan persis (himpunan kata). */
export function clusterNameKey(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/\s*-\s*(implementasi|permit)\b.*$/i, '')
    .replace(/\bspk\s*:?\s*\d+\b/g, '')
    .replace(/[()&,.]/g, ' ');
  return [...new Set(cleaned.split(/\s+/).filter(Boolean))].sort().join(' ');
}

