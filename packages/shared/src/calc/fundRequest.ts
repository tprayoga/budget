import {
  FR_CODES,
  FR_IN_PROCESS_STATUSES,
  FR_SECTION_A,
  type FrCode,
  type FrStatus,
} from '../enums';
import type { ClusterCalcResult } from './budget';
import { D, dec, roundHalfUp, safeDiv, sum, type Num } from './decimal';
import { formatJakartaParts } from '../format/tanggal';

/** Nilai budget per pos form pengajuan, diambil dari hasil kalkulasi budget cluster. */
export function frBudgetAmounts(res: ClusterCalcResult): Record<FrCode, D> {
  return {
    SUBCON: res.lines.SUBCON.amount,
    PERMIT: res.permit.amount,
    TICKET: res.lines.TICKET.amount,
    PAJAK: res.pajak.amount,
    INDIRECT: res.lines.INDIRECT.amount,
    DIRECT: res.lines.DIRECT.amount,
    OPS_KANTOR: res.lines.OPS_KANTOR.amount,
    MOTOR_MOBIL: res.lines.MOTOR_MOBIL.amount,
    HOMEBASE: res.lines.HOMEBASE.amount,
    ALLOWANCE: res.lines.ALLOWANCE.amount,
    MARKETING: res.lines.MARKETING.amount,
  };
}

export function frSection(code: FrCode): 'A' | 'B' {
  return (FR_SECTION_A as readonly string[]).includes(code) ? 'A' : 'B';
}

export interface FrLineInput {
  code: FrCode;
  /** Snapshot budget pos (Rp, 2 desimal). */
  budgetAmount: Num;
  /** Rasio 0..1 (1 = 100%). */
  pctCair: Num;
  /** Σ diajukan pengajuan DICAIRKAN untuk cluster & pos yang sama. */
  sudahDicairkanSebelum?: Num;
  /** Σ diajukan pengajuan yang masih diproses (DIAJUKAN..DIKETAHUI_INVESTOR), kecuali pengajuan ini. */
  sedangDiproses?: Num;
  /** Σ pctCair pos ini dari pengajuan DICAIRKAN + sedang diproses (untuk deteksi termin pelunasan). */
  pctCairSebelumnya?: Num;
  keterangan?: string | null;
}

export interface FrLineResult {
  code: FrCode;
  section: 'A' | 'B';
  budgetAmount: D;
  pctNilaiProyek: D;
  pctCair: D;
  diajukan: D;
  sudahDicairkanSebelum: D;
  sedangDiproses: D;
  /** ROUND(budget) − sudahDicairkanSebelum − diajukan (kolom "Sisa Budget" di form). */
  sisaBudget: D;
  /** ROUND(budget) − sudahDicairkanSebelum − sedangDiproses − diajukan (dipakai validasi). */
  sisaSetelahProses: D;
  /** true bila diajukan disesuaikan ke sisa budget pada termin pelunasan (lihat computeFrLine). */
  penyesuaianPembulatan: boolean;
  overBudget: boolean;
  keterangan: string | null;
}

/**
 * Batas penyesuaian pembulatan termin pelunasan (rupiah). Selisih lebih besar berarti budget
 * berubah di antara termin — tidak disesuaikan, validasi sisa budget tetap berlaku.
 */
const TOLERANSI_PEMBULATAN = new D(1);

/**
 * Hitung satu baris form pengajuan.
 *   diajukan   = ROUND_HALF_UP(budgetAmount × pctCair, 0)
 *   sisaBudget = ROUND_HALF_UP(budgetAmount, 0) − sudahDicairkanSebelum − diajukan
 *
 * Penyesuaian pembulatan termin pelunasan: bila Σ pctCair (sebelumnya + sekarang) tepat 100%,
 * diajukan = sisa yang tersedia, sehingga pembulatan per termin (mis. 2 × ROUND(118.010,625))
 * tidak menghasilkan sisa −1 rupiah. Selisihnya hanya akibat pembulatan dan ditandai.
 */
export function computeFrLine(input: FrLineInput, nilaiProyek: Num): FrLineResult {
  const budgetAmount = dec(input.budgetAmount);
  const pctCair = dec(input.pctCair);
  const sudah = dec(input.sudahDicairkanSebelum);
  const sedang = dec(input.sedangDiproses);
  const budgetRp = roundHalfUp(budgetAmount, 0);

  let diajukan = roundHalfUp(budgetAmount.times(pctCair), 0);
  let penyesuaianPembulatan = false;
  const totalPct = dec(input.pctCairSebelumnya).plus(pctCair);
  if (totalPct.eq(1) && pctCair.gt(0)) {
    const tersedia = D.max(budgetRp.minus(sudah).minus(sedang), 0);
    if (!tersedia.eq(diajukan) && tersedia.minus(diajukan).abs().lte(TOLERANSI_PEMBULATAN)) {
      diajukan = tersedia;
      penyesuaianPembulatan = true;
    }
  }

  const sisaBudget = budgetRp.minus(sudah).minus(diajukan);
  const sisaSetelahProses = sisaBudget.minus(sedang);
  return {
    code: input.code,
    section: frSection(input.code),
    budgetAmount,
    pctNilaiProyek: safeDiv(budgetAmount, nilaiProyek),
    pctCair,
    diajukan,
    sudahDicairkanSebelum: sudah,
    sedangDiproses: sedang,
    sisaBudget,
    sisaSetelahProses,
    penyesuaianPembulatan,
    overBudget: sisaSetelahProses.isNegative() && !sisaSetelahProses.isZero(),
    keterangan: input.keterangan ?? null,
  };
}

export interface FrTotals {
  budgetAmount: D;
  pctNilaiProyek: D;
  diajukan: D;
  sudahDicairkanSebelum: D;
  sedangDiproses: D;
  sisaBudget: D;
}

export interface FundRequestCalc {
  nilaiProyek: D;
  lines: FrLineResult[];
  subtotalA: FrTotals;
  subtotalB: FrTotals;
  total: FrTotals;
  /** Pos yang melanggar validasi sisa budget (sisaSetelahProses < 0). */
  overBudgetCodes: FrCode[];
}

function totals(lines: FrLineResult[]): FrTotals {
  return {
    budgetAmount: sum(lines.map((l) => l.budgetAmount)),
    pctNilaiProyek: sum(lines.map((l) => l.pctNilaiProyek)),
    diajukan: sum(lines.map((l) => l.diajukan)),
    sudahDicairkanSebelum: sum(lines.map((l) => l.sudahDicairkanSebelum)),
    sedangDiproses: sum(lines.map((l) => l.sedangDiproses)),
    sisaBudget: sum(lines.map((l) => l.sisaBudget)),
  };
}

export function computeFundRequest(nilaiProyek: Num, inputs: FrLineInput[]): FundRequestCalc {
  const order = new Map(FR_CODES.map((c, i) => [c, i]));
  const lines = [...inputs]
    .sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0))
    .map((l) => computeFrLine(l, nilaiProyek));
  const a = lines.filter((l) => l.section === 'A');
  const b = lines.filter((l) => l.section === 'B');
  return {
    nilaiProyek: dec(nilaiProyek),
    lines,
    subtotalA: totals(a),
    subtotalB: totals(b),
    total: totals(lines),
    overBudgetCodes: lines.filter((l) => l.overBudget).map((l) => l.code),
  };
}

/** Bentuk minimal pengajuan lain untuk menghitung sudahDicairkanSebelum / sedangDiproses / termin. */
export interface FrHistoryItem {
  id: string;
  status: FrStatus;
  lines: { budgetCode: FrCode; diajukan: Num; pctCair: Num }[];
}

export interface FrHistoryAggregate {
  sudahDicairkanSebelum: Record<FrCode, D>;
  sedangDiproses: Record<FrCode, D>;
  pctCairSebelumnya: Record<FrCode, D>;
  terminKe: number;
}

function emptyByCode(): Record<FrCode, D> {
  return Object.fromEntries(FR_CODES.map((c) => [c, new D(0)])) as Record<FrCode, D>;
}

/**
 * Agregasi riwayat pengajuan satu cluster:
 *   sudahDicairkanSebelum = Σ diajukan status DICAIRKAN
 *   sedangDiproses        = Σ diajukan status DIAJUKAN..DIKETAHUI_INVESTOR (kecuali excludeId)
 *   terminKe              = jumlah pengajuan DICAIRKAN + 1
 */
export function aggregateFrHistory(history: FrHistoryItem[], excludeId?: string | null): FrHistoryAggregate {
  const sudah = emptyByCode();
  const sedang = emptyByCode();
  const pct = emptyByCode();
  let cair = 0;
  const inProcess = FR_IN_PROCESS_STATUSES as readonly FrStatus[];
  for (const fr of history) {
    if (excludeId && fr.id === excludeId) continue;
    const isCair = fr.status === 'DICAIRKAN';
    const isProses = inProcess.includes(fr.status);
    if (isCair) cair++;
    if (!isCair && !isProses) continue;
    for (const l of fr.lines) {
      const target = isCair ? sudah : sedang;
      target[l.budgetCode] = target[l.budgetCode].plus(dec(l.diajukan));
      pct[l.budgetCode] = pct[l.budgetCode].plus(dec(l.pctCair));
    }
  }
  return { sudahDicairkanSebelum: sudah, sedangDiproses: sedang, pctCairSebelumnya: pct, terminKe: cair + 1 };
}

/** Nomor pengajuan: FPD/{PROJECT_CODE}/{YYYY}/{MM}/{seq 3 digit}, bulan menurut Asia/Jakarta. */
export function formatFpdNumber(projectCode: string, tanggal: Date | string, seq: number): string {
  const { year, month } = formatJakartaParts(tanggal);
  return `FPD/${projectCode.toUpperCase()}/${year}/${String(month).padStart(2, '0')}/${String(seq).padStart(3, '0')}`;
}

/** Prefix untuk mencari seq terakhir: FPD/{CODE}/{YYYY}/{MM}/ */
export function fpdPrefix(projectCode: string, tanggal: Date | string): string {
  const { year, month } = formatJakartaParts(tanggal);
  return `FPD/${projectCode.toUpperCase()}/${year}/${String(month).padStart(2, '0')}/`;
}

/** Label sementara pengajuan berstatus DRAFT yang belum pernah disubmit. */
export function draftLabel(id: string): string {
  return `DRAFT-${id.replace(/-/g, '').slice(-6).toUpperCase()}`;
}

export function defaultJustifikasi(clusterName: string, clientName: string): string {
  return `Modal kerja pelaksanaan pekerjaan FTTH ${clusterName.trim()} untuk ${clientName.trim()}.`;
}
