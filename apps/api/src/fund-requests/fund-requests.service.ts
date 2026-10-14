import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FundRequest, type FundRequestLine } from '@prisma/client';
import {
  aggregateFrHistory,
  allowedActions,
  BUDGET_LABEL,
  calcCluster,
  canSubmit,
  computeFundRequest,
  currentStep,
  dec,
  defaultJustifikasi,
  draftLabel,
  formatBulanTahun,
  formatJakartaParts,
  formatFpdNumber,
  FR_CODES,
  FR_DEFAULT_KETERANGAN,
  frBudgetAmounts,
  frDefaultPctCair,
  frHabis,
  frSection,
  inboxStatuses,
  moneyStr,
  sum,
  terbilang,
  todayJakartaIso,
  type ApprovalStep,
  type FrCode,
  type FrCreateInput,
  type FrStatus,
  type FrUpdateInput,
  type FundRequestCalc,
} from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/auth.types';
import { money, rate, s } from '../common/decimal';
import { clusterCalcInput } from '../budget/budget.mapper';
import { StorageService, type UploadedFile } from '../storage/storage.service';
import { RealizationService } from '../realization/realization.service';
import { PdfService } from '../pdf/pdf.service';
import type { RealizationReportData } from '../pdf/realization-report.template';
import { realisasiTanpaPengajuan } from './realisasi-tanpa-pengajuan';

const DETAIL_INCLUDE = {
  lines: true,
  cluster: { include: { project: { include: { client: true } } } },
  diajukanOleh: { select: { id: true, name: true, jabatan: true, email: true } },
  overrideBy: { select: { id: true, name: true } },
  approvals: { include: { user: { select: { id: true, name: true, role: true, jabatan: true } } }, orderBy: { at: 'asc' } },
  attachments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FundRequestInclude;

type FrDetail = Prisma.FundRequestGetPayload<{ include: typeof DETAIL_INCLUDE }>;

interface LineIntent {
  budgetCode: FrCode;
  /** null = pakai default (sisa tersedia / budget). */
  pctCair: string | null;
  keterangan: string | null;
}

/** Tanggal "YYYY-MM-DD" → Date UTC tengah malam (kolom @db.Date). */
function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Representasi datar pengajuan untuk audit log. */
function flatForAudit(fr: (FundRequest & { lines: FundRequestLine[] }) | null) {
  if (!fr) return null;
  const o: Record<string, string | null> = {
    status: fr.status,
    number: fr.number,
    terminKe: String(fr.terminKe),
    tanggal: isoDate(fr.tanggal),
    periode: fr.periode,
    diajukanKepada: fr.diajukanKepada,
    justifikasi: fr.justifikasi,
    rekeningBank: fr.rekeningBank,
    rekeningNo: fr.rekeningNo,
    rekeningNama: fr.rekeningNama,
    nilaiProyek: s(fr.nilaiProyek),
    interestRate: s(fr.interestRate),
    retensiAsCost: String(fr.retensiAsCost),
    totalDiajukan: s(fr.totalDiajukan),
    overrideReason: fr.overrideReason,
    cairTanggal: isoDate(fr.cairTanggal),
  };
  for (const l of fr.lines) {
    o[`line.${l.budgetCode}.budgetAmount`] = s(l.budgetAmount);
    o[`line.${l.budgetCode}.pctCair`] = s(l.pctCair);
    o[`line.${l.budgetCode}.diajukan`] = s(l.diajukan);
    o[`line.${l.budgetCode}.sudahDicairkanSebelum`] = s(l.sudahDicairkanSebelum);
    o[`line.${l.budgetCode}.sedangDiproses`] = s(l.sedangDiproses);
    o[`line.${l.budgetCode}.realisasiTanpaPengajuan`] = s(l.realisasiTanpaPengajuan);
    o[`line.${l.budgetCode}.keterangan`] = l.keterangan;
  }
  return o;
}

@Injectable()
export class FundRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly realization: RealizationService,
    private readonly pdf: PdfService,
  ) {}

  // ---------------------------------------------------------------- query

  async list(user: AuthUser, q: { status?: FrStatus; projectId?: string; clusterId?: string; q?: string }) {
    const rows = await this.prisma.fundRequest.findMany({
      where: {
        ...this.access.fundRequestWhere(user),
        status: q.status,
        clusterId: q.clusterId,
        ...(q.projectId ? { cluster: { projectId: q.projectId, ...this.access.clusterWhere(user) } } : {}),
        ...(q.q
          ? {
              OR: [
                { number: { contains: q.q, mode: 'insensitive' } },
                { cluster: { name: { contains: q.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        cluster: { select: { id: true, name: true, project: { select: { id: true, code: true, name: true } } } },
        diajukanOleh: { select: { id: true, name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((f) => ({
      id: f.id,
      number: f.number,
      label: f.number ?? draftLabel(f.id),
      status: f.status,
      terminKe: f.terminKe,
      tanggal: isoDate(f.tanggal),
      totalDiajukan: s(f.totalDiajukan),
      cluster: { id: f.cluster.id, name: f.cluster.name },
      project: f.cluster.project,
      diajukanOleh: f.diajukanOleh,
      submittedAt: f.submittedAt,
      updatedAt: f.updatedAt,
      allowedActions: allowedActions(f.status, user.role),
    }));
  }

  /** Pengajuan yang menunggu tindakan role user. PM hanya melihat pengajuan DITOLAK miliknya. */
  async inbox(user: AuthUser) {
    const statuses = inboxStatuses(user.role);
    if (!statuses.length) return { count: 0, items: [] };
    const all = await this.list(user, {});
    const items = all.filter(
      (f) =>
        statuses.includes(f.status) &&
        !(f.status === 'DITOLAK' && user.role === 'PM' && f.diajukanOleh.id !== user.id),
    );
    return { count: items.length, items };
  }

  async get(user: AuthUser, id: string) {
    let fr = await this.loadVisible(user, id);
    if (fr.status === 'DRAFT' && (await this.refreshDraft(fr))) fr = await this.loadVisible(user, id);
    return this.view(user, fr);
  }

  /**
   * Draft dibuka: bila realisasi tanpa pengajuan berubah sejak draft disimpan (mis. draft lama sebelum realisasi
   * RAB diperhitungkan), hitung ulang. % cair pos yang melebihi sisa tersedia diturunkan ke % sisa (pos habis → 0).
   * Ditandai recalcNote (banner) sampai disubmit; perubahan diaudit (pelaku sistem).
   */
  private async refreshDraft(fr: FrDetail): Promise<boolean> {
    const real = await realisasiTanpaPengajuan(this.prisma, fr.clusterId);
    const stored = new Map(fr.lines.map((l) => [l.budgetCode, dec(l.realisasiTanpaPengajuan.toString())]));
    if (FR_CODES.every((c) => (stored.get(c) ?? dec(0)).eq(real[c].toFixed(2)))) return false;
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.fundRequest.findUniqueOrThrow({ where: { id: fr.id }, include: { lines: true } });
      const probe = await this.computeDraft(tx, fr.id, fr.clusterId, this.intentsFromLines(before.lines));
      const intents = this.intentsFromLines(before.lines).map((i) => {
        const line = probe.frCalc.lines.find((l) => l.code === i.budgetCode)!;
        const def = frDefaultPctCair(line);
        return i.pctCair !== null && dec(i.pctCair).gt(def) ? { ...i, pctCair: def.toString() } : i;
      });
      const c = await this.computeDraft(tx, fr.id, fr.clusterId, intents);
      await this.persistComputation(tx, fr.id, c);
      const total = sum(FR_CODES.map((code) => real[code]));
      await tx.fundRequest.update({
        where: { id: fr.id },
        data: { recalcNote: `Angka diperbarui karena realisasi sebelumnya (Rp ${moneyStr(total)} di luar pengajuan) — ${todayJakartaIso()}` },
      });
      const after = await tx.fundRequest.findUniqueOrThrow({ where: { id: fr.id }, include: { lines: true } });
      await this.audit.diff(tx, null, 'FundRequest', fr.id, flatForAudit(before), { ...flatForAudit(after)!, sumber: 'hitung ulang realisasi tanpa pengajuan' });
    });
    return true;
  }

  private async loadVisible(user: AuthUser, id: string, tx: Tx | PrismaService = this.prisma): Promise<FrDetail> {
    const fr = await tx.fundRequest.findFirst({
      where: { id, ...this.access.fundRequestWhere(user) },
      include: DETAIL_INCLUDE,
    });
    if (!fr) throw new NotFoundException('Pengajuan tidak ditemukan');
    return fr;
  }

  /**
   * Detail siap tampil (dipakai web & PDF). DRAFT dihitung ulang live dari budget/setting terkini;
   * status lain memakai snapshot yang dibekukan saat SUBMIT.
   */
  async view(user: AuthUser | null, fr: FrDetail) {
    const live = fr.status === 'DRAFT';
    let calc: FundRequestCalc;
    let snapshot: {
      nilaiProyek: string;
      interestRate: string;
      retensiAsCost: boolean;
      infoBunga: string;
      infoRetensi: string;
      infoProfit: string;
      infoMargin: string;
      terminKe: number;
    };
    if (live) {
      const c = await this.computeDraft(this.prisma, fr.id, fr.clusterId, this.intentsFromLines(fr.lines));
      calc = c.frCalc;
      snapshot = c.snapshot;
    } else {
      calc = this.frozenCalc(fr);
      snapshot = {
        nilaiProyek: fr.nilaiProyek.toString(),
        interestRate: fr.interestRate.toString(),
        retensiAsCost: fr.retensiAsCost,
        infoBunga: fr.infoBunga.toString(),
        infoRetensi: fr.infoRetensi.toString(),
        infoProfit: fr.infoProfit.toString(),
        infoMargin: fr.infoMargin.toString(),
        terminKe: fr.terminKe,
      };
    }
    const lineMeta = new Map(fr.lines.map((l) => [l.budgetCode, l]));
    const lines = calc.lines.map((l) => ({
      budgetCode: l.code,
      label: lineMeta.get(l.code)?.label ?? BUDGET_LABEL[l.code],
      section: l.section,
      budgetAmount: moneyStr(l.budgetAmount),
      pctNilaiProyek: l.pctNilaiProyek.toDecimalPlaces(8).toFixed(8),
      pctCair: l.pctCair.toString(),
      diajukan: moneyStr(l.diajukan),
      sudahDicairkanSebelum: moneyStr(l.sudahDicairkanSebelum),
      sedangDiproses: moneyStr(l.sedangDiproses),
      realisasiTanpaPengajuan: moneyStr(l.realisasiTanpaPengajuan),
      sudahTerpakai: moneyStr(l.sudahTerpakai),
      sisaTersedia: moneyStr(l.sisaTersedia),
      /** % cair "sisa budget" (dibulatkan ke bawah 0,01%) — tombol cepat wizard. */
      pctSisa: frDefaultPctCair(l).toString(),
      habis: l.habis,
      sisaBudget: moneyStr(l.sisaBudget),
      sisaSetelahProses: moneyStr(l.sisaSetelahProses),
      penyesuaianPembulatan: l.penyesuaianPembulatan,
      overBudget: l.overBudget,
      keterangan: l.keterangan,
    }));
    const tot = (t: FundRequestCalc['total']) => ({
      budgetAmount: moneyStr(t.budgetAmount),
      pctNilaiProyek: t.pctNilaiProyek.toDecimalPlaces(8).toFixed(8),
      diajukan: moneyStr(t.diajukan),
      sudahDicairkanSebelum: moneyStr(t.sudahDicairkanSebelum),
      sedangDiproses: moneyStr(t.sedangDiproses),
      realisasiTanpaPengajuan: moneyStr(t.realisasiTanpaPengajuan),
      sudahTerpakai: moneyStr(t.sudahTerpakai),
      sisaTersedia: moneyStr(t.sisaTersedia),
      sisaBudget: moneyStr(t.sisaBudget),
    });

    return {
      recalcNote: live ? fr.recalcNote : null,
      id: fr.id,
      number: fr.number,
      label: fr.number ?? draftLabel(fr.id),
      status: fr.status,
      live,
      terminKe: snapshot.terminKe,
      tanggal: isoDate(fr.tanggal),
      periode: fr.periode,
      diajukanKepada: fr.diajukanKepada,
      justifikasi: fr.justifikasi,
      rekeningBank: fr.rekeningBank,
      rekeningNo: fr.rekeningNo,
      rekeningNama: fr.rekeningNama,
      cluster: { id: fr.cluster.id, name: fr.cluster.name, info: fr.cluster.info },
      project: { id: fr.cluster.project.id, code: fr.cluster.project.code, name: fr.cluster.project.name },
      client: { id: fr.cluster.project.client.id, name: fr.cluster.project.client.name },
      diajukanOleh: fr.diajukanOleh,
      snapshot,
      lines,
      subtotalA: tot(calc.subtotalA),
      subtotalB: tot(calc.subtotalB),
      total: tot(calc.total),
      terbilang: terbilang(calc.total.diajukan),
      overBudgetCodes: calc.overBudgetCodes,
      approvals: fr.approvals.map((a) => ({
        id: a.id,
        step: a.step,
        action: a.action,
        note: a.note,
        at: a.at,
        user: a.user,
      })),
      signatures: this.signatures(fr),
      attachments: fr.attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        label: a.label,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        hasFile: !!a.fileUrl,
        checked: a.checked,
        createdAt: a.createdAt,
      })),
      submittedAt: fr.submittedAt,
      cairTanggal: isoDate(fr.cairTanggal),
      cairBuktiAttachmentId: fr.cairBuktiAttachmentId,
      overrideReason: fr.overrideReason,
      overrideBy: fr.overrideBy,
      rejectedNote: fr.rejectedNote,
      createdAt: fr.createdAt,
      updatedAt: fr.updatedAt,
      allowedActions: user ? this.actionsFor(user, fr) : [],
    };
  }

  private actionsFor(user: AuthUser, fr: FrDetail) {
    const actions = allowedActions(fr.status, user.role);
    const isOwner = fr.diajukanOlehId === user.id || user.role === 'ADMIN';
    return actions.filter((a) => (a === 'SUBMIT' || a === 'REVISE' ? isOwner : true));
  }

  /** Nama & tanggal penanda tangan dari approval siklus terakhir (setelah submit terakhir). */
  private signatures(fr: FrDetail) {
    const lastSubmit = fr.approvals.map((a) => a.step).lastIndexOf('DIAJUKAN');
    const cycle = lastSubmit >= 0 ? fr.approvals.slice(lastSubmit) : [];
    const pick = (step: ApprovalStep) => {
      const a = cycle.find((x) => x.step === step && x.action === 'APPROVE');
      return a ? { name: a.user.name, jabatan: a.user.jabatan, at: a.at } : null;
    };
    return {
      DIAJUKAN: pick('DIAJUKAN') ?? { name: fr.diajukanOleh.name, jabatan: fr.diajukanOleh.jabatan, at: null },
      PERIKSA_FINANCE: pick('PERIKSA_FINANCE'),
      SETUJU_DIREKTUR: pick('SETUJU_DIREKTUR'),
      MENGETAHUI_INVESTOR: pick('MENGETAHUI_INVESTOR'),
      PENCAIRAN: pick('PENCAIRAN'),
    };
  }

  private intentsFromLines(lines: FundRequestLine[]): LineIntent[] {
    return lines.map((l) => ({ budgetCode: l.budgetCode, pctCair: l.pctCair.toString() as string | null, keterangan: l.keterangan }));
  }

  /** Bentuk FundRequestCalc dari baris snapshot (status selain DRAFT). */
  private frozenCalc(fr: FrDetail): FundRequestCalc {
    const order = new Map(FR_CODES.map((c, i) => [c, i]));
    const lines = [...fr.lines]
      .sort((a, b) => (order.get(a.budgetCode) ?? 0) - (order.get(b.budgetCode) ?? 0))
      .map((l) => {
        const sisaBudget = dec(l.sisaBudget.toString());
        const sisaSetelahProses = sisaBudget.minus(dec(l.sedangDiproses.toString()));
        const diajukan = dec(l.diajukan.toString());
        const sudahDicairkanSebelum = dec(l.sudahDicairkanSebelum.toString());
        const realisasi = dec(l.realisasiTanpaPengajuan.toString());
        const sisaTersedia = sisaSetelahProses.plus(diajukan);
        return {
          code: l.budgetCode,
          section: frSection(l.budgetCode),
          budgetAmount: dec(l.budgetAmount.toString()),
          pctNilaiProyek: dec(l.pctNilaiProyek.toString()),
          pctCair: dec(l.pctCair.toString()),
          diajukan,
          sudahDicairkanSebelum,
          sedangDiproses: dec(l.sedangDiproses.toString()),
          realisasiTanpaPengajuan: realisasi,
          sudahTerpakai: sudahDicairkanSebelum.plus(realisasi),
          sisaTersedia,
          habis: frHabis(sisaTersedia),
          sisaBudget,
          sisaSetelahProses,
          penyesuaianPembulatan: false,
          overBudget: diajukan.gt(0) && sisaSetelahProses.isNegative() && !sisaSetelahProses.isZero(),
          keterangan: l.keterangan,
        };
      });
    const tot = (ls: typeof lines) => ({
      budgetAmount: sum(ls.map((l) => l.budgetAmount)),
      pctNilaiProyek: sum(ls.map((l) => l.pctNilaiProyek)),
      diajukan: sum(ls.map((l) => l.diajukan)),
      sudahDicairkanSebelum: sum(ls.map((l) => l.sudahDicairkanSebelum)),
      sedangDiproses: sum(ls.map((l) => l.sedangDiproses)),
      realisasiTanpaPengajuan: sum(ls.map((l) => l.realisasiTanpaPengajuan)),
      sudahTerpakai: sum(ls.map((l) => l.sudahTerpakai)),
      sisaTersedia: sum(ls.map((l) => (l.habis ? dec(0) : l.sisaTersedia.toDecimalPlaces(0, 1)))),
      sisaBudget: sum(ls.map((l) => l.sisaBudget)),
    });
    return {
      nilaiProyek: dec(fr.nilaiProyek.toString()),
      lines,
      subtotalA: tot(lines.filter((l) => l.section === 'A')),
      subtotalB: tot(lines.filter((l) => l.section === 'B')),
      total: tot(lines),
      overBudgetCodes: lines.filter((l) => l.overBudget).map((l) => l.code),
    };
  }

  // ---------------------------------------------------------------- kalkulasi

  /**
   * Hitung pengajuan dari budget & setting terkini + riwayat pengajuan cluster
   * (sudahDicairkanSebelum = DICAIRKAN, sedangDiproses = DIAJUKAN..DIKETAHUI_INVESTOR, kecuali diri sendiri).
   */
  private async computeDraft(tx: Tx | PrismaService, frId: string | null, clusterId: string, intents: LineIntent[]) {
    const cluster = await tx.cluster.findUniqueOrThrow({
      where: { id: clusterId },
      include: { budgetLines: true, project: { include: { client: true } } },
    });
    const setting = await this.settings.effective(cluster.projectId, tx);
    const calc = calcCluster(clusterCalcInput(cluster, setting));
    const amounts = frBudgetAmounts(calc);
    const history = await tx.fundRequest.findMany({
      where: { clusterId },
      select: { id: true, status: true, lines: { select: { budgetCode: true, diajukan: true, pctCair: true } } },
    });
    const hist = aggregateFrHistory(
      history.map((h) => ({
        id: h.id,
        status: h.status,
        lines: h.lines.map((l) => ({ budgetCode: l.budgetCode, diajukan: l.diajukan.toString(), pctCair: l.pctCair.toString() })),
      })),
      frId,
      cluster.terminOffset,
    );
    const real = await realisasiTanpaPengajuan(tx, clusterId);
    const byCode = new Map(intents.map((i) => [i.budgetCode, i]));
    const frCalc = computeFundRequest(
      calc.nilaiProyek,
      FR_CODES.map((code) => {
        const base = {
          code,
          budgetAmount: moneyStr(amounts[code]),
          sudahDicairkanSebelum: hist.sudahDicairkanSebelum[code],
          sedangDiproses: hist.sedangDiproses[code],
          realisasiTanpaPengajuan: real[code],
          pctCairSebelumnya: hist.pctCairSebelumnya[code],
        };
        // default % cair = sisa tersedia / budget (pos habis → 0)
        const pct = byCode.get(code)?.pctCair ?? frDefaultPctCair(base).toString();
        return { ...base, pctCair: pct, keterangan: byCode.has(code) ? byCode.get(code)!.keterangan : (FR_DEFAULT_KETERANGAN[code] ?? null) };
      }),
    );
    return {
      cluster,
      setting,
      calc,
      frCalc,
      snapshot: {
        nilaiProyek: moneyStr(calc.nilaiProyek),
        interestRate: setting.interestRate,
        retensiAsCost: setting.retensiAsCost,
        infoBunga: moneyStr(calc.interest.amount),
        infoRetensi: moneyStr(calc.retensi.amount),
        infoProfit: moneyStr(calc.profit),
        infoMargin: calc.margin.toDecimalPlaces(8).toFixed(8),
        terminKe: hist.terminKe,
      },
    };
  }

  /** Tulis hasil kalkulasi ke baris & kolom snapshot pengajuan. */
  private async persistComputation(tx: Tx, frId: string, c: Awaited<ReturnType<FundRequestsService['computeDraft']>>) {
    await tx.fundRequestLine.deleteMany({ where: { fundRequestId: frId } });
    await tx.fundRequestLine.createMany({
      data: c.frCalc.lines.map((l, i) => ({
        fundRequestId: frId,
        budgetCode: l.code,
        label: BUDGET_LABEL[l.code],
        budgetAmount: money(l.budgetAmount),
        pctNilaiProyek: rate(l.pctNilaiProyek),
        pctCair: rate(l.pctCair),
        diajukan: money(l.diajukan),
        sudahDicairkanSebelum: money(l.sudahDicairkanSebelum),
        sedangDiproses: money(l.sedangDiproses),
        realisasiTanpaPengajuan: money(l.realisasiTanpaPengajuan),
        sisaBudget: money(l.sisaBudget),
        keterangan: l.keterangan,
        sortOrder: i,
      })),
    });
    await tx.fundRequest.update({
      where: { id: frId },
      data: {
        terminKe: c.snapshot.terminKe,
        nilaiProyek: money(c.snapshot.nilaiProyek),
        interestRate: rate(c.snapshot.interestRate),
        retensiAsCost: c.snapshot.retensiAsCost,
        infoBunga: money(c.snapshot.infoBunga),
        infoRetensi: money(c.snapshot.infoRetensi),
        infoProfit: money(c.snapshot.infoProfit),
        infoMargin: rate(c.snapshot.infoMargin),
        totalDiajukan: money(c.frCalc.total.diajukan),
      },
    });
  }

  /** Kunci baris cluster agar validasi sisa budget & penomoran tidak balapan antar transaksi. */
  private async lockCluster(tx: Tx, clusterId: string) {
    await tx.$queryRaw`SELECT id FROM "Cluster" WHERE id = ${clusterId} FOR UPDATE`;
  }

  private overBudgetError(calc: FundRequestCalc) {
    const details = calc.lines
      .filter((l) => l.overBudget)
      .map((l) => ({
        budgetCode: l.code,
        label: BUDGET_LABEL[l.code],
        diajukan: moneyStr(l.diajukan),
        sudahDicairkanSebelum: moneyStr(l.sudahDicairkanSebelum),
        sedangDiproses: moneyStr(l.sedangDiproses),
        realisasiTanpaPengajuan: moneyStr(l.realisasiTanpaPengajuan),
        sisa: moneyStr(l.sisaSetelahProses),
      }));
    return new ConflictException({
      message: `Pengajuan melebihi sisa budget pada pos: ${details.map((d) => d.label).join(', ')}`,
      code: 'OVER_BUDGET',
      overBudget: details,
    });
  }

  /**
   * Validasi ulang dengan riwayat terkini: ROUND(budget) − sudahDicairkan − sedangDiproses − diajukan ≥ 0.
   * Untuk pengajuan yang sudah dibekukan, budget & diajukan memakai snapshot.
   */
  private async revalidateFrozen(tx: Tx, fr: FundRequest & { lines: FundRequestLine[] }) {
    const history = await tx.fundRequest.findMany({
      where: { clusterId: fr.clusterId },
      select: { id: true, status: true, lines: { select: { budgetCode: true, diajukan: true, pctCair: true } } },
    });
    const hist = aggregateFrHistory(
      history.map((h) => ({
        id: h.id,
        status: h.status,
        lines: h.lines.map((l) => ({ budgetCode: l.budgetCode, diajukan: l.diajukan.toString(), pctCair: l.pctCair.toString() })),
      })),
      fr.id,
    );
    const real = await realisasiTanpaPengajuan(tx, fr.clusterId);
    const lines = fr.lines.map((l) => {
      const budgetRp = dec(l.budgetAmount.toString()).toDecimalPlaces(0, 4);
      const sisa = budgetRp
        .minus(hist.sudahDicairkanSebelum[l.budgetCode])
        .minus(hist.sedangDiproses[l.budgetCode])
        .minus(real[l.budgetCode])
        .minus(dec(l.diajukan.toString()));
      return { l, sisa };
    });
    // pos yang tidak diajukan (diajukan 0) tidak menggagalkan validasi walaupun sudah over
    const bad = lines.filter((x) => dec(x.l.diajukan.toString()).gt(0) && x.sisa.isNegative() && !x.sisa.isZero());
    if (bad.length && !fr.overrideReason) {
      throw new ConflictException({
        message: `Pengajuan melebihi sisa budget pada pos: ${bad.map((b) => b.l.label).join(', ')}`,
        code: 'OVER_BUDGET',
        overBudget: bad.map((b) => ({
          budgetCode: b.l.budgetCode,
          label: b.l.label,
          diajukan: b.l.diajukan.toString(),
          sudahDicairkanSebelum: hist.sudahDicairkanSebelum[b.l.budgetCode].toFixed(2),
          sedangDiproses: hist.sedangDiproses[b.l.budgetCode].toFixed(2),
          realisasiTanpaPengajuan: real[b.l.budgetCode].toFixed(2),
          sisa: b.sisa.toFixed(2),
        })),
      });
    }
  }

  // ---------------------------------------------------------------- mutasi

  private normalizeIntents(lines: FrCreateInput['lines'], existing?: LineIntent[]): LineIntent[] {
    const base = new Map<FrCode, LineIntent>(
      (existing ?? FR_CODES.map((c) => ({ budgetCode: c, pctCair: null, keterangan: FR_DEFAULT_KETERANGAN[c] ?? null }))).map(
        (i) => [i.budgetCode, i],
      ),
    );
    for (const l of lines ?? []) {
      const prev = base.get(l.budgetCode);
      base.set(l.budgetCode, {
        budgetCode: l.budgetCode,
        pctCair: l.pctCair,
        keterangan: l.keterangan !== undefined ? (l.keterangan ?? null) : (prev?.keterangan ?? null),
      });
    }
    return FR_CODES.map((c) => base.get(c) ?? { budgetCode: c, pctCair: null, keterangan: FR_DEFAULT_KETERANGAN[c] ?? null });
  }

  async create(user: AuthUser, input: FrCreateInput) {
    if (!canSubmit(user.role)) throw new ForbiddenException('Hanya PM/Admin yang dapat membuat pengajuan');
    const cluster = await this.access.assertCluster(user, input.clusterId);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: cluster.projectId }, include: { client: true } });
    const setting = await this.settings.effective(project.id);
    const tanggal = input.tanggal ?? todayJakartaIso();

    const id = await this.prisma.$transaction(async (tx) => {
      const c = await this.computeDraft(tx, null, cluster.id, this.normalizeIntents(input.lines));
      const fr = await tx.fundRequest.create({
        data: {
          clusterId: cluster.id,
          terminKe: c.snapshot.terminKe,
          tanggal: toDate(tanggal),
          periode: input.periode ?? formatBulanTahun(toDate(tanggal)),
          diajukanOlehId: user.id,
          diajukanKepada: input.diajukanKepada || 'Investor',
          justifikasi: input.justifikasi || defaultJustifikasi(cluster.name, project.client.name),
          rekeningBank: input.rekeningBank ?? setting.rekeningBank,
          rekeningNo: input.rekeningNo ?? setting.rekeningNo,
          rekeningNama: input.rekeningNama ?? setting.rekeningNama,
          nilaiProyek: 0,
          interestRate: 0,
          retensiAsCost: setting.retensiAsCost,
          infoBunga: 0,
          infoRetensi: 0,
          infoProfit: 0,
          infoMargin: 0,
          totalDiajukan: 0,
        },
      });
      await this.persistComputation(tx, fr.id, c);
      for (const kind of ['PROYEKSI_BUDGET', 'PO_SPK', 'RENCANA_KERJA'] as const) {
        await tx.attachment.create({ data: { fundRequestId: fr.id, kind, checked: false } });
      }
      const after = await tx.fundRequest.findUniqueOrThrow({ where: { id: fr.id }, include: { lines: true } });
      await this.audit.diff(tx, user.id, 'FundRequest', fr.id, null, flatForAudit(after)!);
      return fr.id;
    });
    return this.get(user, id);
  }

  private assertOwner(user: AuthUser, fr: { diajukanOlehId: string }) {
    if (fr.diajukanOlehId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Hanya pemohon atau Admin yang dapat mengubah pengajuan ini');
    }
  }

  async update(user: AuthUser, id: string, input: FrUpdateInput) {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.loadVisible(user, id, tx);
      if (before.status !== 'DRAFT') throw new ConflictException('Pengajuan hanya bisa diubah saat DRAFT');
      this.assertOwner(user, before);
      await tx.fundRequest.update({
        where: { id },
        data: {
          tanggal: input.tanggal ? toDate(input.tanggal) : undefined,
          periode: input.periode === undefined ? undefined : input.periode,
          diajukanKepada: input.diajukanKepada || undefined,
          justifikasi: input.justifikasi === undefined ? undefined : input.justifikasi || before.justifikasi,
          rekeningBank: input.rekeningBank === undefined ? undefined : input.rekeningBank,
          rekeningNo: input.rekeningNo === undefined ? undefined : input.rekeningNo,
          rekeningNama: input.rekeningNama === undefined ? undefined : input.rekeningNama,
        },
      });
      const c = await this.computeDraft(
        tx,
        id,
        before.clusterId,
        this.normalizeIntents(input.lines, this.intentsFromLines(before.lines)),
      );
      await this.persistComputation(tx, id, c);
      const after = await tx.fundRequest.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      await this.audit.diff(tx, user.id, 'FundRequest', id, flatForAudit(before), flatForAudit(after)!);
    });
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const files = await this.prisma.$transaction(async (tx) => {
      const fr = await this.loadVisible(user, id, tx);
      if (fr.status !== 'DRAFT' || fr.number) {
        throw new ConflictException('Hanya draft yang belum pernah diajukan yang bisa dihapus');
      }
      this.assertOwner(user, fr);
      await tx.fundRequest.delete({ where: { id } });
      await this.audit.diff(tx, user.id, 'FundRequest', id, { status: fr.status }, { status: 'DIHAPUS' });
      return fr.attachments.map((a) => a.fileUrl).filter((u): u is string => !!u);
    });
    for (const f of files) await this.storage.remove(f);
    return { ok: true };
  }

  /**
   * SUBMIT: kunci cluster, hitung ulang, validasi sisa budget (termasuk sedangDiproses),
   * bekukan snapshot, beri nomor FPD (sekali saja — revisi memakai nomor lama).
   */
  async submit(user: AuthUser, id: string, opts: { override?: boolean; overrideReason?: string | null }) {
    await this.prisma.$transaction(async (tx) => {
      const pre = await this.loadVisible(user, id, tx);
      await this.lockCluster(tx, pre.clusterId);
      const before = await tx.fundRequest.findUniqueOrThrow({
        where: { id },
        include: { lines: true, cluster: { include: { project: true } } },
      });
      if (before.status !== 'DRAFT') throw new ConflictException('Pengajuan sudah diajukan');
      if (!canSubmit(user.role)) throw new ForbiddenException('Role Anda tidak dapat mengajukan');
      this.assertOwner(user, before);

      const c = await this.computeDraft(tx, id, before.clusterId, this.intentsFromLines(before.lines));
      if (c.frCalc.total.diajukan.lte(0)) throw new BadRequestException('Total pengajuan harus lebih dari 0');
      let overrideReason: string | null = null;
      if (c.frCalc.overBudgetCodes.length) {
        if (opts.override && user.role === 'ADMIN' && opts.overrideReason?.trim()) {
          overrideReason = opts.overrideReason.trim();
        } else if (opts.override && user.role !== 'ADMIN') {
          throw new ForbiddenException('Override sisa budget hanya untuk Admin');
        } else if (opts.override) {
          throw new BadRequestException('Alasan override wajib diisi');
        } else {
          throw this.overBudgetError(c.frCalc);
        }
      }
      await this.persistComputation(tx, id, c);

      let number = before.number;
      if (!number) {
        const { year, month } = formatJakartaParts(before.tanggal);
        const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
          INSERT INTO "FpdSequence" ("projectId", "year", "month", "lastSeq")
          VALUES (${before.cluster.projectId}, ${year}, ${month}, 1)
          ON CONFLICT ("projectId", "year", "month")
          DO UPDATE SET "lastSeq" = "FpdSequence"."lastSeq" + 1
          RETURNING "lastSeq"`;
        number = formatFpdNumber(before.cluster.project.code, before.tanggal, Number(rows[0].lastSeq));
      }
      await tx.fundRequest.update({
        where: { id },
        data: {
          number,
          status: 'DIAJUKAN',
          submittedAt: new Date(),
          rejectedNote: null,
          recalcNote: null,
          overrideReason,
          overrideById: overrideReason ? user.id : null,
        },
      });
      await tx.approval.create({ data: { fundRequestId: id, step: 'DIAJUKAN', userId: user.id, action: 'APPROVE' } });
      const after = await tx.fundRequest.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      await this.audit.diff(tx, user.id, 'FundRequest', id, flatForAudit(before), flatForAudit(after)!);
    });
    return this.get(user, id);
  }

  private async decide(
    user: AuthUser,
    id: string,
    action: 'APPROVE' | 'REJECT' | 'DISBURSE',
    note: string | null | undefined,
    extra?: (tx: Tx, fr: FundRequest) => Promise<Prisma.FundRequestUpdateInput>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const pre = await this.loadVisible(user, id, tx);
      await this.lockCluster(tx, pre.clusterId);
      const before = await tx.fundRequest.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      const step = currentStep(before.status);
      const actions = allowedActions(before.status, user.role);
      if (!step || !actions.includes(action)) {
        throw new ForbiddenException('Aksi tidak diizinkan untuk role/status ini');
      }
      if (action !== 'REJECT') await this.revalidateFrozen(tx, before);

      const data: Prisma.FundRequestUpdateInput = {
        status: action === 'REJECT' ? 'DITOLAK' : step.next,
        rejectedNote: action === 'REJECT' ? (note ?? null) : undefined,
        ...(extra ? await extra(tx, before) : {}),
      };
      await tx.fundRequest.update({ where: { id }, data });
      await tx.approval.create({
        data: {
          fundRequestId: id,
          step: step.step,
          userId: user.id,
          action: action === 'REJECT' ? 'REJECT' : 'APPROVE',
          note: note ?? null,
        },
      });
      const after = await tx.fundRequest.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      await this.audit.diff(tx, user.id, 'FundRequest', id, flatForAudit(before), flatForAudit(after)!);
    });
    return this.get(user, id);
  }

  approve(user: AuthUser, id: string, note?: string | null) {
    return this.decide(user, id, 'APPROVE', note);
  }

  reject(user: AuthUser, id: string, note: string) {
    return this.decide(user, id, 'REJECT', note);
  }

  /** FINANCE menandai DICAIRKAN dengan tanggal & bukti transfer. */
  async disburse(user: AuthUser, id: string, input: { cairTanggal: string; note?: string | null }, file?: UploadedFile) {
    if (!file) throw new BadRequestException('Bukti pencairan wajib diunggah');
    const stored = await this.storage.save(id, file);
    try {
      return await this.decide(user, id, 'DISBURSE', input.note, async (tx) => {
        const att = await tx.attachment.create({
          data: {
            fundRequestId: id,
            kind: 'BUKTI_CAIR',
            fileUrl: stored.fileUrl,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            size: stored.size,
            checked: true,
            uploadedById: user.id,
          },
        });
        return { cairTanggal: toDate(input.cairTanggal), cairBukti: { connect: { id: att.id } } };
      });
    } catch (e) {
      await this.storage.remove(stored.fileUrl);
      throw e;
    }
  }

  /** DITOLAK → DRAFT agar pemohon bisa memperbaiki. Nomor FPD tetap. */
  async revise(user: AuthUser, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.loadVisible(user, id, tx);
      if (before.status !== 'DITOLAK') throw new ConflictException('Hanya pengajuan DITOLAK yang bisa direvisi');
      if (!canSubmit(user.role)) throw new ForbiddenException('Role Anda tidak dapat merevisi');
      this.assertOwner(user, before);
      await tx.fundRequest.update({ where: { id }, data: { status: 'DRAFT', overrideReason: null, overrideById: null } });
      const after = await tx.fundRequest.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      await this.audit.diff(tx, user.id, 'FundRequest', id, flatForAudit(before), flatForAudit(after)!);
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- lampiran

  async addAttachment(
    user: AuthUser,
    id: string,
    input: { kind: string; label?: string | null; checked?: boolean },
    file?: UploadedFile,
  ) {
    const fr = await this.loadVisible(user, id);
    if (fr.status !== 'DRAFT') throw new ConflictException('Lampiran hanya bisa diubah saat DRAFT');
    this.assertOwner(user, fr);
    if (input.kind === 'BUKTI_CAIR') throw new BadRequestException('Bukti cair diunggah saat pencairan');
    const stored = file ? await this.storage.save(id, file) : null;
    const att = await this.prisma.attachment.create({
      data: {
        fundRequestId: id,
        kind: input.kind as Prisma.AttachmentCreateInput['kind'],
        label: input.label ?? null,
        checked: input.checked ?? !!stored,
        fileUrl: stored?.fileUrl ?? null,
        fileName: stored?.fileName ?? null,
        mimeType: stored?.mimeType ?? null,
        size: stored?.size ?? null,
        uploadedById: user.id,
      },
    });
    await this.audit.diff(this.prisma, user.id, 'Attachment', att.id, null, {
      fundRequestId: id,
      kind: att.kind,
      fileName: att.fileName,
      checked: att.checked,
    });
    return att;
  }

  async updateAttachment(user: AuthUser, id: string, attId: string, input: { checked?: boolean; label?: string | null }) {
    const fr = await this.loadVisible(user, id);
    if (fr.status !== 'DRAFT') throw new ConflictException('Lampiran hanya bisa diubah saat DRAFT');
    this.assertOwner(user, fr);
    const before = await this.prisma.attachment.findFirst({ where: { id: attId, fundRequestId: id } });
    if (!before) throw new NotFoundException('Lampiran tidak ditemukan');
    const att = await this.prisma.attachment.update({
      where: { id: attId },
      data: { checked: input.checked, label: input.label === undefined ? undefined : input.label },
    });
    await this.audit.diff(
      this.prisma,
      user.id,
      'Attachment',
      attId,
      { checked: before.checked, label: before.label },
      { checked: att.checked, label: att.label },
    );
    return att;
  }

  async removeAttachment(user: AuthUser, id: string, attId: string) {
    const fr = await this.loadVisible(user, id);
    if (fr.status !== 'DRAFT') throw new ConflictException('Lampiran hanya bisa diubah saat DRAFT');
    this.assertOwner(user, fr);
    const att = await this.prisma.attachment.findFirst({ where: { id: attId, fundRequestId: id } });
    if (!att) throw new NotFoundException('Lampiran tidak ditemukan');
    await this.prisma.attachment.delete({ where: { id: attId } });
    if (att.fileUrl) await this.storage.remove(att.fileUrl);
    await this.audit.diff(this.prisma, user.id, 'Attachment', attId, { kind: att.kind, fileName: att.fileName }, { kind: null, fileName: null });
    return { ok: true };
  }

  async attachmentFile(user: AuthUser, id: string, attId: string) {
    await this.loadVisible(user, id);
    const att = await this.prisma.attachment.findFirst({ where: { id: attId, fundRequestId: id } });
    if (!att?.fileUrl) throw new NotFoundException('File tidak ditemukan');
    return { path: this.storage.absolute(att.fileUrl), fileName: att.fileName ?? 'lampiran', mimeType: att.mimeType };
  }

  // ---------------------------------------------------------------- realisasi (Fase 2)

  /** Dana cair vs realisasi vs sisa dana di tangan + daftar expense yang ditautkan. */
  async realizationUsage(user: AuthUser, id: string) {
    const fr = await this.loadVisible(user, id);
    const usage = await this.realization.fundRequestUsage(fr.id);
    const expenses = await this.prisma.expense.findMany({
      where: { fundRequestId: fr.id },
      include: { allocations: { where: { clusterId: fr.clusterId } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      ...usage,
      expenses: expenses.map((e) => ({
        id: e.id,
        date: isoDate(e.date),
        category: e.category,
        budgetCode: e.budgetCode,
        description: e.description,
        vendor: e.vendor,
        invoiceNo: e.invoiceNo,
        status: e.status,
        amount: s(e.amount),
        clusterAmount: s(e.allocations[0]?.amount ?? null),
      })),
    };
  }

  async realizationReportData(user: AuthUser, id: string): Promise<RealizationReportData> {
    const fr = await this.loadVisible(user, id);
    const usage = await this.realizationUsage(user, id);
    return {
      fr: {
        label: fr.number ?? draftLabel(fr.id),
        terminKe: fr.terminKe,
        cairTanggal: isoDate(fr.cairTanggal),
        cluster: fr.cluster.name,
        project: `${fr.cluster.project.code} — ${fr.cluster.project.name}`,
        client: fr.cluster.project.client.name,
      },
      usage: { rows: usage.rows, total: usage.total },
      expenses: usage.expenses
        .filter((e) => e.status === 'TERVERIFIKASI')
        .map((e) => ({ date: e.date, category: e.category, description: e.description, vendor: e.vendor, invoiceNo: e.invoiceNo, amount: e.clusterAmount ?? e.amount ?? '0' })),
      generatedAt: new Date(),
      generatedBy: user.name,
    };
  }

  async realizationReportPdf(user: AuthUser, id: string) {
    const data = await this.realizationReportData(user, id);
    return { label: data.fr.label, pdf: await this.pdf.realizationReportPdf(data) };
  }

  /**
   * Lampiran otomatis "Laporan realisasi termin sebelumnya": PDF realisasi pengajuan DICAIRKAN terakhir
   * pada cluster yang sama, disimpan sebagai lampiran LAPORAN_TERMIN_SEBELUMNYA (tercentang).
   */
  async generatePreviousReport(user: AuthUser, id: string) {
    const fr = await this.loadVisible(user, id);
    if (fr.status !== 'DRAFT') throw new ConflictException('Lampiran hanya bisa diubah saat DRAFT');
    this.assertOwner(user, fr);
    const prev = await this.prisma.fundRequest.findFirst({
      where: { clusterId: fr.clusterId, status: 'DICAIRKAN', id: { not: fr.id } },
      orderBy: [{ cairTanggal: 'desc' }, { submittedAt: 'desc' }],
    });
    if (!prev) throw new NotFoundException('Belum ada termin sebelumnya yang dicairkan untuk cluster ini');
    const { label, pdf } = await this.realizationReportPdf(user, prev.id);
    const fileName = `Laporan_Realisasi_${label.replace(/[^\w-]+/g, '_')}.pdf`;
    const stored = await this.storage.save(fr.id, { originalname: fileName, mimetype: 'application/pdf', size: pdf.length, buffer: pdf });
    const old = await this.prisma.attachment.findMany({ where: { fundRequestId: fr.id, kind: 'LAPORAN_TERMIN_SEBELUMNYA', label: { startsWith: 'Laporan realisasi' } } });
    const att = await this.prisma.$transaction(async (tx) => {
      await tx.attachment.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      const a = await tx.attachment.create({
        data: {
          fundRequestId: fr.id,
          kind: 'LAPORAN_TERMIN_SEBELUMNYA',
          label: `Laporan realisasi ${label}`,
          fileUrl: stored.fileUrl,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          size: stored.size,
          checked: true,
          uploadedById: user.id,
        },
      });
      await this.audit.diff(tx, user.id, 'Attachment', a.id, null, { fundRequestId: fr.id, kind: a.kind, fileName: a.fileName, sumber: `otomatis dari ${label}` });
      return a;
    });
    for (const o of old) if (o.fileUrl) await this.storage.remove(o.fileUrl);
    return { id: att.id, fileName: att.fileName, previous: { id: prev.id, number: prev.number } };
  }

  /** Muat detail untuk PDF/export (sudah dicek akses). */
  async detailForPdf(user: AuthUser, id: string) {
    return this.view(user, await this.loadVisible(user, id));
  }
}
