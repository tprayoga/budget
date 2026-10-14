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
  /**
   * Σ alokasi expense TERVERIFIKASI ke cluster & pos ini yang tidak ditautkan ke pengajuan (fundRequestId = null),
   * mis. realisasi hasil import RAB sebelum sistem. Biaya ini sudah dibayar → tidak boleh diajukan lagi.
   */
  realisasiTanpaPengajuan?: Num;
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
  realisasiTanpaPengajuan: D;
  /** sudahDicairkanSebelum + realisasiTanpaPengajuan (kolom "Sudah Terpakai/Dicairkan" di form). */
  sudahTerpakai: D;
  /** ROUND(budget) − sudahDicairkan − sedangDiproses − realisasiTanpaPengajuan (yang masih bisa diajukan). */
  sisaTersedia: D;
  /** ROUND(budget) − sudahTerpakai − diajukan (kolom "Sisa Budget" di form). */
  sisaBudget: D;
  /** sisaTersedia − diajukan (dipakai validasi; nama lama dipertahankan untuk kompatibilitas). */
  sisaSetelahProses: D;
  /** Pos tanpa sisa (sisaTersedia < Rp 1) → % cair 0, input dinonaktifkan; negatif = over. */
  habis: boolean;
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

/** Sisa yang masih bisa diajukan per pos (rupiah, presisi penuh). */
export function frSisaTersedia(input: Pick<FrLineInput, 'budgetAmount' | 'sudahDicairkanSebelum' | 'sedangDiproses' | 'realisasiTanpaPengajuan'>): D {
  return roundHalfUp(dec(input.budgetAmount), 0)
    .minus(dec(input.sudahDicairkanSebelum))
    .minus(dec(input.sedangDiproses))
    .minus(dec(input.realisasiTanpaPengajuan));
}

/** Pos dianggap habis bila sisa tersedia < Rp 1 (sisa sen akibat alokasi tidak bisa diajukan). */
export function frHabis(sisaTersedia: Num): boolean {
  return dec(sisaTersedia).lt(1);
}

/**
 * % cair default = sisaTersedia / budget, dibulatkan ke BAWAH 2 desimal persen (rasio 4 desimal).
 * Pos habis / budget 0 → 0.
 */
export function frDefaultPctCair(input: Pick<FrLineInput, 'budgetAmount' | 'sudahDicairkanSebelum' | 'sedangDiproses' | 'realisasiTanpaPengajuan'>): D {
  const budget = dec(input.budgetAmount);
  const sisa = frSisaTersedia(input);
  if (budget.lte(0) || frHabis(sisa)) return new D(0);
  return D.min(sisa.div(budget), 1).toDecimalPlaces(4, D.ROUND_DOWN);
}

/**
 * Hitung satu baris form pengajuan.
 *   diajukan              = ROUND_HALF_UP(budgetAmount × pctCair, 0)
 *   sisaTersedia          = ROUND(budget) − sudahDicairkan − sedangDiproses − realisasiTanpaPengajuan
 *   sisaSetelahPengajuan  = sisaTersedia − diajukan   (validasi ≥ 0 untuk pos yang diajukan)
 *   sisaBudget (form)     = ROUND(budget) − (sudahDicairkan + realisasiTanpaPengajuan) − diajukan
 *
 * Aturan pelunasan: bila diajukan "mencapai sisa" — Σ pctCair (sebelumnya + sekarang) tepat 100% dengan selisih
 * ≤ Rp 1, atau selisih dengan sisa tersedia (dibulatkan ke bawah ke rupiah) ≤ 1 langkah % (0,01% × budget, min Rp 1) —
 * diajukan = sisa tersedia, sehingga pembulatan tidak meninggalkan sisa receh/minus. Ditandai penyesuaianPembulatan.
 * Pos yang sudah over (sisa < 0) tetapi tidak diajukan (diajukan 0) tidak menggagalkan validasi.
 */
export function computeFrLine(input: FrLineInput, nilaiProyek: Num): FrLineResult {
  const budgetAmount = dec(input.budgetAmount);
  const pctCair = dec(input.pctCair);
  const sudah = dec(input.sudahDicairkanSebelum);
  const sedang = dec(input.sedangDiproses);
  const realisasi = dec(input.realisasiTanpaPengajuan);
  const budgetRp = roundHalfUp(budgetAmount, 0);
  const sisaTersedia = budgetRp.minus(sudah).minus(sedang).minus(realisasi);

  let diajukan = roundHalfUp(budgetAmount.times(pctCair), 0);
  let penyesuaianPembulatan = false;
  if (pctCair.gt(0)) {
    const tersedia = D.max(sisaTersedia, 0).toDecimalPlaces(0, D.ROUND_DOWN);
    const totalPct = dec(input.pctCairSebelumnya).plus(pctCair);
    const langkah = D.max(budgetAmount.times('0.0001'), TOLERANSI_PEMBULATAN);
    const selisih = tersedia.minus(diajukan).abs();
    const pelunasan = (totalPct.eq(1) && selisih.lte(TOLERANSI_PEMBULATAN)) || selisih.lte(langkah);
    if (!tersedia.eq(diajukan) && pelunasan) {
      diajukan = tersedia;
      penyesuaianPembulatan = true;
    }
  }

  const sudahTerpakai = sudah.plus(realisasi);
  const sisaBudget = budgetRp.minus(sudahTerpakai).minus(diajukan);
  const sisaSetelahProses = sisaTersedia.minus(diajukan);
  return {
    code: input.code,
    section: frSection(input.code),
    budgetAmount,
    pctNilaiProyek: safeDiv(budgetAmount, nilaiProyek),
    pctCair,
    diajukan,
    sudahDicairkanSebelum: sudah,
    sedangDiproses: sedang,
    realisasiTanpaPengajuan: realisasi,
    sudahTerpakai,
    sisaTersedia,
    sisaBudget,
    sisaSetelahProses,
    habis: frHabis(sisaTersedia),
    penyesuaianPembulatan,
    overBudget: diajukan.gt(0) && sisaSetelahProses.isNegative() && !sisaSetelahProses.isZero(),
    keterangan: input.keterangan ?? null,
  };
}

export interface FrTotals {
  budgetAmount: D;
  pctNilaiProyek: D;
  diajukan: D;
  sudahDicairkanSebelum: D;
  sedangDiproses: D;
  realisasiTanpaPengajuan: D;
  sudahTerpakai: D;
  /** Σ max(sisaTersedia, 0) dibulatkan ke bawah per pos ke rupiah — total yang masih bisa diajukan. */
  sisaTersedia: D;
  sisaBudget: D;
}

export interface FundRequestCalc {
  nilaiProyek: D;
  lines: FrLineResult[];
  subtotalA: FrTotals;
  subtotalB: FrTotals;
  total: FrTotals;
  /** Pos yang melanggar validasi sisa budget (diajukan > 0 dan sisaSetelahPengajuan < 0). */
  overBudgetCodes: FrCode[];
}

function totals(lines: FrLineResult[]): FrTotals {
  return {
    budgetAmount: sum(lines.map((l) => l.budgetAmount)),
    pctNilaiProyek: sum(lines.map((l) => l.pctNilaiProyek)),
    diajukan: sum(lines.map((l) => l.diajukan)),
    sudahDicairkanSebelum: sum(lines.map((l) => l.sudahDicairkanSebelum)),
    sedangDiproses: sum(lines.map((l) => l.sedangDiproses)),
    realisasiTanpaPengajuan: sum(lines.map((l) => l.realisasiTanpaPengajuan)),
    sudahTerpakai: sum(lines.map((l) => l.sudahTerpakai)),
    sisaTersedia: sum(lines.map((l) => (l.habis ? new D(0) : l.sisaTersedia.toDecimalPlaces(0, D.ROUND_DOWN)))),
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
 *   terminKe              = jumlah pengajuan DICAIRKAN + terminOffset + 1
 * terminOffset = jumlah termin yang sudah terjadi sebelum sistem (diset ADMIN per cluster, default 0).
 */
export function aggregateFrHistory(history: FrHistoryItem[], excludeId?: string | null, terminOffset = 0): FrHistoryAggregate {
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
  return { sudahDicairkanSebelum: sudah, sedangDiproses: sedang, pctCairSebelumnya: pct, terminKe: cair + terminOffset + 1 };
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
