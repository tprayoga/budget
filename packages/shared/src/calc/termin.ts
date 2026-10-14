import type { AgingType } from '../enums';
import { dec, roundMoney, sum, type Num } from './decimal';

export interface TerminLineInput {
  terminKe: number;
  pct: Num;
  keterangan?: string | null;
}

/**
 * Generate nilai termin klien dari template: amount = ROUND(pct × base, 2),
 * termin terakhir menerima sisa pembulatan sehingga Σ amount = Σpct × base.
 */
export function generateTermins(lines: TerminLineInput[], base: Num) {
  const b = dec(base);
  const sorted = [...lines].sort((x, y) => x.terminKe - y.terminKe);
  const target = roundMoney(sum(sorted.map((l) => dec(l.pct))).times(b));
  const out = sorted.map((l) => ({ terminKe: l.terminKe, pct: dec(l.pct), keterangan: l.keterangan ?? null, amount: roundMoney(dec(l.pct).times(b)) }));
  if (out.length) {
    const others = sum(out.slice(0, -1).map((o) => o.amount));
    out[out.length - 1].amount = target.minus(others);
  }
  return out;
}

/** "YYYY-MM-DD" untuk Date (UTC, kolom @db.Date). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(v: Date | string): Date {
  const s = typeof v === 'string' ? v.slice(0, 10) : isoDay(v);
  return new Date(`${s}T00:00:00.000Z`);
}

/** Tambah N hari kerja (Senin–Jumat), melewati tanggal di `holidays` ("YYYY-MM-DD"). */
export function addWorkingDays(start: Date | string, n: number, holidays: Iterable<string> = []): Date {
  const off = new Set(holidays);
  const d = parseDay(start);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || off.has(isoDay(d))) continue;
    left--;
  }
  return d;
}

/**
 * Jatuh tempo invoice: CALENDAR = invoiceDate + N hari; WORKING = N hari kerja (lewati Sabtu, Minggu, hari libur).
 * agingDays null → tidak dihitung otomatis.
 */
export function calcDueDate(
  invoiceDate: Date | string,
  agingDays: number | null | undefined,
  agingType: AgingType | null | undefined,
  holidays: Iterable<string> = [],
): Date | null {
  if (agingDays === null || agingDays === undefined || !agingType) return null;
  if (agingType === 'WORKING') return addWorkingDays(invoiceDate, agingDays, holidays);
  const d = parseDay(invoiceDate);
  d.setUTCDate(d.getUTCDate() + agingDays);
  return d;
}


/**
 * Tambah N bulan kalender ke tanggal ("YYYY-MM-DD"/Date, UTC). Tanggal yang tidak ada di bulan tujuan
 * dijepit ke akhir bulan (31 Mei + 3 bulan = 31 Agustus; 30 Nov + 3 bulan = 28/29 Februari).
 * Dipakai tanggal pelepasan retensi = tanggal opname + N bulan.
 */
export function addMonths(start: Date | string, months: number): Date {
  const d = parseDay(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}
