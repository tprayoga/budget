import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClientInvoiceRef, ClientPayment, ClientPaymentStatus, Prisma, PrismaClient, TerminKind } from '@prisma/client';
import {
  addMonths,
  calcDueDate,
  dec,
  generateTermins,
  matchReferenceToTermin,
  moneyStr,
  paymentDeduction,
  PO_KIND_LABEL,
  referenceTarget,
  REF_MATCH_TOLERANCE,
  sum,
  terminTax,
  todayJakartaIso,
  type ApplyInvoiceRefInput,
  type ApplyMatchedRefsInput,
  type ClientPaymentUpdateInput,
} from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../auth/auth.types';
import { money, rate, s } from '../common/decimal';
import { ExpenseSupportService } from './expense-support.service';
import { adjustmentSum, ADJUSTMENT_PO_KINDS, generateClientPayments, primaryImplPo, TEMPLATE_PO_KINDS, terminTaxDefaults } from './termin-generator';
import { ensureClusterPos, poDto } from '../clusters/po-support';
import { scanOverruns } from '../notifications/overrun';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (v: string) => new Date(`${v}T00:00:00Z`);
type Db = PrismaClient | Tx;

/**
 * Tanggal invoice belum diisi: termin sudah ditagih / punya nomor invoice / termin manual, tapi invoiceDate kosong.
 * (Tanggal tidak pernah ditebak — dibiarkan kosong sampai FINANCE mengisi.)
 */
export function needsInvoiceDate(p: Pick<ClientPayment, 'invoiceDate' | 'status' | 'invoiceNo' | 'fromTemplate'>) {
  return !p.invoiceDate && (p.status !== 'UNBILLED' || !!p.invoiceNo || !p.fromTemplate);
}
/** Dibayar (dari referensi RAB "Paid") tetapi tanggal diterima belum diketahui. */
export function needsPaidDate(p: Pick<ClientPayment, 'status' | 'paidDate'>) {
  return p.status === 'PAID' && !p.paidDate;
}
export const NEEDS_INVOICE_DATE_WHERE: Prisma.ClientPaymentWhereInput = {
  OR: [
    { invoiceDate: null, OR: [{ status: { not: 'UNBILLED' } }, { invoiceNo: { not: null } }, { fromTemplate: false }] },
    { status: 'PAID', paidDate: null },
  ],
};

/** Pajak termin (DPP = amount): PPN titipan, tagihan, PPh, net yang diharapkan. */
export function paymentTax(p: Pick<ClientPayment, 'amount' | 'ppnRate' | 'pphRate'>) {
  return terminTax({ amount: p.amount.toString(), ppnRate: p.ppnRate.toString(), pphRate: p.pphRate.toString() });
}

function refDto(r: ClientInvoiceRef, suggestion: RefSuggestion | null = null, ambiguous = false) {
  return {
    id: r.id,
    sourceRef: r.sourceRef,
    clusterId: r.clusterId,
    blockTitle: r.blockTitle,
    termin: r.termin,
    invoiceNo: r.invoiceNo,
    netAmount: s(r.netAmount),
    dueDate: iso(r.dueDate),
    statusText: r.statusText,
    paid: r.paid,
    appliedPaymentId: r.appliedPaymentId,
    appliedAt: r.appliedAt,
    /** Usulan termin yang cocok (net = expectedNet ± Rp 10) — tetap harus dikonfirmasi FINANCE. */
    suggestion,
    ambiguous,
  };
}

export function paymentDto(p: ClientPayment) {
  const t = paymentTax(p);
  return {
    id: p.id,
    clusterId: p.clusterId,
    poId: p.poId,
    fromTemplate: p.fromTemplate,
    needsInvoiceDate: needsInvoiceDate(p),
    needsPaidDate: needsPaidDate(p),
    kind: p.kind,
    termin: p.termin,
    pct: s(p.pct),
    /** DPP */
    amount: s(p.amount)!,
    ppnRate: s(p.ppnRate)!,
    pphRate: s(p.pphRate)!,
    ppnAmount: moneyStr(t.ppn),
    pphAmount: moneyStr(t.pph),
    invoiceTotal: moneyStr(t.invoiceTotal),
    expectedNet: moneyStr(t.expectedNet),
    keterangan: p.keterangan,
    retentionMonths: p.retentionMonths,
    opnameDate: iso(p.opnameDate),
    retentionReleaseDate: iso(p.retentionReleaseDate),
    invoiceNo: p.invoiceNo,
    invoiceDate: iso(p.invoiceDate),
    dueDate: iso(p.dueDate),
    paidDate: iso(p.paidDate),
    paidAmount: s(p.paidAmount),
    potongan: paymentDeduction(t.invoiceTotal, p.status === 'PAID' ? p.paidAmount?.toString() : null).toFixed(2),
    status: p.status,
    updatedAt: p.updatedAt,
  };
}

function flat(p: ClientPayment | null) {
  if (!p) return null;
  return {
    amount: s(p.amount),
    ppnRate: s(p.ppnRate),
    pphRate: s(p.pphRate),
    invoiceNo: p.invoiceNo,
    invoiceDate: iso(p.invoiceDate),
    dueDate: iso(p.dueDate),
    paidDate: iso(p.paidDate),
    paidAmount: s(p.paidAmount),
    status: p.status,
    keterangan: p.keterangan,
    opnameDate: iso(p.opnameDate),
    retentionReleaseDate: iso(p.retentionReleaseDate),
  };
}

export interface RefSuggestion {
  /**
   * NET = nilai referensi cocok dengan nilai pembanding sesuai setting client (Client.referenceValueType);
   * DPP = nilai referensi = DPP termin (tanpa PPN/PPh) — perlu konfirmasi pajak.
   */
  mode: 'NET' | 'DPP';
  /** Nilai pembanding yang dipakai (setting client): NET (DPP + PPN − PPh), INVOICE_TOTAL (DPP + PPN), atau DPP. */
  basis: 'NET' | 'INVOICE_TOTAL' | 'DPP';
  /** Mode DPP: perlu konfirmasi pajak (mis. invoice tanpa PPN) — tidak ikut "Terapkan semua yang cocok". */
  perluKonfirmasiPajak: boolean;
  paymentId: string;
  clusterId: string;
  clusterName: string;
  kind: TerminKind;
  termin: number;
  expectedNet: string;
  selisih: string;
}

/**
 * Usulan pencocokan referensi tagihan RAB (belum diterapkan) → termin belum dibayar, per project.
 * Referensi bercluster dicocokkan ke termin cluster itu; referensi tingkat project ke semua termin project.
 * Satu termin hanya diusulkan untuk satu referensi (yang pertama, urut invoice).
 */
export async function referenceMatches(db: Db, projectId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { client: true } });
  const valueType = project.client.referenceValueType;
  const refs = await db.clientInvoiceRef.findMany({ where: { projectId }, orderBy: [{ blockTitle: 'asc' }, { termin: 'asc' }, { invoiceNo: 'asc' }] });
  const payments = await db.clientPayment.findMany({
    where: { cluster: { projectId }, status: { not: 'PAID' }, invoiceRefs: { none: {} } },
    include: { cluster: { select: { name: true } } },
  });
  const taken = new Set<string>();
  const out = new Map<string, { suggestion: RefSuggestion | null; ambiguous: boolean }>();
  for (const r of refs) {
    if (r.appliedPaymentId) {
      out.set(r.id, { suggestion: null, ambiguous: false });
      continue;
    }
    // nilai pembanding per client (INVOICE_TOTAL / NET); status Paid/Unpaid hanya menentukan PAID vs INVOICED
    const cands = payments
      .filter((p) => !taken.has(p.id) && (!r.clusterId || p.clusterId === r.clusterId))
      .map((p) => ({ id: p.id, termin: p.termin, expectedNet: referenceTarget(paymentTax(p), valueType), group: p.poId, p }));
    let m = matchReferenceToTermin({ netAmount: r.netAmount?.toString() ?? null, termin: r.termin }, cands);
    let mode: 'NET' | 'DPP' = 'NET';
    if (!m.match && !m.ambiguous) {
      // mode kedua: net referensi = DPP termin (tanpa PPN/PPh) — hanya usulan, perlu konfirmasi pajak
      const byDpp = matchReferenceToTermin(
        { netAmount: r.netAmount?.toString() ?? null, termin: r.termin },
        cands.map((c) => ({ ...c, expectedNet: c.p.amount.toString() })),
      );
      if (byDpp.match || byDpp.ambiguous) {
        m = byDpp as typeof m;
        mode = 'DPP';
      }
    }
    if (m.match) {
      taken.add(m.match.id);
      const target = mode === 'DPP' ? dec(m.match.p.amount.toString()) : dec(m.match.expectedNet.toString());
      out.set(r.id, {
        suggestion: {
          mode,
          basis: mode === 'DPP' ? 'DPP' : valueType,
          perluKonfirmasiPajak: mode === 'DPP',
          paymentId: m.match.id,
          clusterId: m.match.p.clusterId,
          clusterName: m.match.p.cluster.name,
          kind: m.match.p.kind,
          termin: m.match.termin,
          expectedNet: moneyStr(target),
          selisih: moneyStr(target.minus(r.netAmount!.toString())),
        },
        ambiguous: false,
      });
    } else out.set(r.id, { suggestion: null, ambiguous: m.ambiguous });
  }
  return { refs, matches: out, valueType };
}

/**
 * Termin pembayaran klien per cluster.
 * - amount = DPP; PPN keluaran (titipan) & PPh dihitung dari ppnRate/pphRate termin.
 * - Jatuh tempo dihitung dari template aging (kalender / hari kerja melewati Sabtu, Minggu, HariLibur).
 * - Bila status PAID dan diterima < DPP + PPN, selisihnya otomatis menjadi expense PAJAK
 *   (TERVERIFIKASI, source CLIENT_PAYMENT, ikut berubah/terhapus saat pembayaran diedit).
 */
@Injectable()
export class ClientPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly support: ExpenseSupportService,
  ) {}

  /** Termin per PO + referensi tagihan RAB (cluster ini; referensi tingkat project yang cocok ke cluster ini / tanpa usulan). */
  async list(user: AuthUser, clusterId: string) {
    await this.access.assertCluster(user, clusterId);
    const rows = await this.prisma.clientPayment.findMany({ where: { clusterId }, orderBy: [{ kind: 'asc' }, { termin: 'asc' }] });
    const c = await this.prisma.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
    const templates = await this.prisma.terminTemplate.findMany({ where: { clientId: c.project.clientId }, include: { lines: true } });
    const pos = await this.prisma.clusterPo.findMany({ where: { clusterId }, orderBy: { createdAt: 'asc' } });
    const { refs, matches } = await referenceMatches(this.prisma, c.projectId);
    const appliedHere = new Set(rows.map((r) => r.id));
    const visible = refs.filter((r) => {
      if (r.clusterId) return r.clusterId === clusterId;
      if (r.appliedPaymentId) return appliedHere.has(r.appliedPaymentId);
      const m = matches.get(r.id)?.suggestion;
      return !m || m.clusterId === clusterId;
    });
    const paid = rows.filter((r) => r.status === 'PAID');
    return {
      pos: pos.map(poDto),
      payments: rows.map(paymentDto),
      templates: templates.map((t) => ({ kind: t.kind, agingDays: t.agingDays, agingType: t.agingType, lines: t.lines.length })),
      invoiceRefs: visible.map((r) => refDto(r, matches.get(r.id)?.suggestion ?? null, matches.get(r.id)?.ambiguous ?? false)),
      missingInvoiceDate: rows.filter((r) => needsInvoiceDate(r) || needsPaidDate(r)).length,
      totals: {
        dpp: moneyStr(sum(rows.map((r) => r.amount.toString()))),
        ppn: moneyStr(sum(rows.map((r) => paymentTax(r).ppn))),
        /** PPN keluaran (titipan) atas termin yang sudah dibayar. */
        ppnTitipan: moneyStr(sum(paid.map((r) => paymentTax(r).ppn))),
      },
    };
  }

  private async holidays(db: Tx | PrismaService) {
    return (await db.hariLibur.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10));
  }

  private async template(db: Tx | PrismaService, clusterId: string, kind: TerminKind) {
    if (!(TEMPLATE_PO_KINDS as readonly string[]).includes(kind)) return null;
    const c = await db.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
    return db.terminTemplate.findUnique({ where: { clientId_kind: { clientId: c.project.clientId, kind } } });
  }

  /**
   * Status mengikuti data: ada paidAmount & (paidDate, atau sebelumnya sudah PAID dari referensi tanpa tanggal) → PAID;
   * ada invoiceDate → INVOICED; selain itu UNBILLED.
   */
  private deriveStatus(p: { invoiceDate: Date | null; paidDate: Date | null; paidAmount: Prisma.Decimal | null; wasPaid?: boolean }): ClientPaymentStatus {
    if (p.paidAmount && (p.paidDate || p.wasPaid)) return 'PAID';
    if (p.invoiceDate) return 'INVOICED';
    return 'UNBILLED';
  }

  async update(user: AuthUser, id: string, input: ClientPaymentUpdateInput) {
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.clientPayment.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Termin tidak ditemukan');
      await this.access.assertCluster(user, before.clusterId);
      const tpl = await this.template(tx, before.clusterId, before.kind);

      const invoiceDate = input.invoiceDate !== undefined ? (input.invoiceDate ? day(input.invoiceDate) : null) : before.invoiceDate;
      const paidDate = input.paidDate !== undefined ? (input.paidDate ? day(input.paidDate) : null) : before.paidDate;
      const paidAmount = input.paidAmount !== undefined ? (input.paidAmount ? money(input.paidAmount) : null) : before.paidAmount;
      const amount = input.amount !== undefined ? money(input.amount) : before.amount;
      const opnameDate = input.opnameDate !== undefined ? (input.opnameDate ? day(input.opnameDate) : null) : before.opnameDate;
      const retentionReleaseDate = opnameDate && before.retentionMonths ? addMonths(opnameDate, before.retentionMonths) : null;
      const ppnRate = input.ppnRate !== undefined ? rate(input.ppnRate) : before.ppnRate;
      const pphRate = input.pphRate !== undefined ? rate(input.pphRate) : before.pphRate;
      const tax = terminTax({ amount: amount.toString(), ppnRate: ppnRate.toString(), pphRate: pphRate.toString() });
      if (paidAmount && paidAmount.gt(tax.invoiceTotal.toFixed(2))) throw new BadRequestException('Nominal diterima melebihi tagihan (DPP + PPN)');

      let dueDate = before.dueDate;
      if (tpl?.agingDays != null && tpl.agingType) {
        dueDate = invoiceDate ? calcDueDate(invoiceDate, tpl.agingDays, tpl.agingType, await this.holidays(tx)) : null;
      } else if (input.dueDate !== undefined) {
        dueDate = input.dueDate ? day(input.dueDate) : null;
      }
      // PAID dari referensi tanpa tanggal tetap PAID selama nominal diterima tidak dihapus
      const wasPaid = before.status === 'PAID' && !before.paidDate && input.paidDate === undefined;
      let status = this.deriveStatus({ invoiceDate, paidDate, paidAmount, wasPaid });
      if (input.status && input.status !== status) {
        if (input.status === 'PAID' && !(paidDate && paidAmount)) throw new BadRequestException('Status Dibayar wajib tanggal & nominal diterima');
        if (input.status === 'INVOICED' && !invoiceDate) throw new BadRequestException('Status Ditagih wajib tanggal invoice');
        status = input.status;
      }

      const after = await tx.clientPayment.update({
        where: { id },
        data: {
          amount,
          ppnRate,
          pphRate,
          opnameDate,
          retentionReleaseDate,
          keterangan: input.keterangan !== undefined ? input.keterangan : undefined,
          invoiceNo: input.invoiceNo !== undefined ? input.invoiceNo : undefined,
          invoiceDate,
          dueDate,
          paidDate,
          paidAmount,
          status,
        },
      });
      await this.audit.diff(tx, user.id, 'ClientPayment', id, flat(before), flat(after)!);
      await this.syncTaxExpense(tx, after, user.id);
      return after;
    });
    await scanOverruns(this.prisma, [result.clusterId]);
    return paymentDto(result);
  }

  /**
   * Terapkan satu referensi ke termin (dalam transaksi). DPP = isian FINANCE (default DPP termin),
   * paidAmount = net referensi, invoiceNo & jatuh tempo dari referensi. Paid → PAID (tanggal diterima = isian /
   * jatuh tempo RAB / kosong → ditandai perlu dilengkapi), Unpaid → INVOICED. Tanggal invoice tidak diisi dari RAB.
   */
  private async applyRefTx(tx: Tx, userId: string, before: ClientPayment, ref: ClientInvoiceRef, dpp: string | null, paidDateInput: string | null | undefined) {
    if (ref.appliedPaymentId) throw new ConflictException(`Referensi ${ref.invoiceNo} sudah diterapkan ke termin lain`);
    if (before.status === 'PAID') throw new ConflictException('Termin sudah dibayar');
    const amount = dpp ? money(dpp) : before.amount;
    const net = ref.netAmount;
    if (ref.paid && !net) throw new BadRequestException('Referensi Paid tanpa nilai net — isi termin manual');
    const tax = terminTax({ amount: amount.toString(), ppnRate: before.ppnRate.toString(), pphRate: before.pphRate.toString() });
    // toleransi sama dengan pencocokan (± Rp 10) — selisih pembulatan termin vs invoice
    if (net && net.gt(tax.invoiceTotal.plus(REF_MATCH_TOLERANCE).toFixed(2))) throw new BadRequestException('Nilai net referensi melebihi tagihan (DPP + PPN) termin');
    const paid = ref.paid && !!net;
    const paidDate = paid ? (paidDateInput ? day(paidDateInput) : ref.dueDate) : null;
    const after = await tx.clientPayment.update({
      where: { id: before.id },
      data: { amount, invoiceNo: ref.invoiceNo, dueDate: ref.dueDate ?? before.dueDate, paidAmount: paid ? net : null, paidDate, status: paid ? 'PAID' : 'INVOICED' },
    });
    await tx.clientInvoiceRef.update({ where: { id: ref.id }, data: { appliedPaymentId: before.id, appliedAt: new Date(), appliedById: userId } });
    await this.audit.diff(tx, userId, 'ClientPayment', before.id, flat(before), { ...flat(after)!, sumber: `referensi RAB ${ref.sourceRef}` });
    await this.syncTaxExpense(tx, after, userId);
    return after;
  }

  /** Terapkan referensi tagihan RAB ke termin pilihan FINANCE (per baris; tidak pernah otomatis). */
  async applyReference(user: AuthUser, paymentId: string, input: ApplyInvoiceRefInput) {
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.clientPayment.findUnique({ where: { id: paymentId } });
      if (!before) throw new NotFoundException('Termin tidak ditemukan');
      const c = await this.access.assertCluster(user, before.clusterId);
      const ref = await tx.clientInvoiceRef.findUnique({ where: { id: input.refId } });
      if (!ref || ref.projectId !== c.projectId || (ref.clusterId && ref.clusterId !== before.clusterId)) {
        throw new NotFoundException('Referensi tagihan tidak ditemukan untuk cluster ini');
      }
      return this.applyRefTx(tx, user.id, before, ref, input.amount, input.paidDate);
    });
    await scanOverruns(this.prisma, [result.clusterId]);
    return paymentDto(result);
  }

  /**
   * "Terapkan semua yang cocok": konfirmasi FINANCE atas usulan pencocokan yang tampil di cluster ini
   * (opsional hanya `refIds`). DPP termin tidak diubah. Tanggal diterima untuk referensi Paid tanpa jatuh tempo
   * memakai `paidDate` bila diisi, selain itu dibiarkan kosong (badge perlu dilengkapi).
   */
  async applyMatched(user: AuthUser, clusterId: string, input: ApplyMatchedRefsInput) {
    const c = await this.access.assertCluster(user, clusterId);
    const applied = await this.prisma.$transaction(async (tx) => {
      const { refs, matches } = await referenceMatches(tx, c.projectId);
      const out: { refId: string; invoiceNo: string; paymentId: string; termin: number; kind: string }[] = [];
      for (const r of refs) {
        const m = matches.get(r.id)?.suggestion;
        // mode DPP (perlu konfirmasi pajak) tidak pernah diterapkan lewat konfirmasi massal/usulan
        if (!m || m.mode !== 'NET' || m.clusterId !== clusterId || (input.refIds && !input.refIds.includes(r.id))) continue;
        const before = await tx.clientPayment.findUniqueOrThrow({ where: { id: m.paymentId } });
        await this.applyRefTx(tx, user.id, before, r, null, input.paidDate);
        out.push({ refId: r.id, invoiceNo: r.invoiceNo, paymentId: m.paymentId, termin: m.termin, kind: m.kind });
      }
      return out;
    });
    if (applied.length) await scanOverruns(this.prisma, [clusterId]);
    return { applied };
  }

  /**
   * Halaman FINANCE "Pembayaran klien belum lengkap" — termin yang perlu dikejar input pembayaran aslinya:
   *  - UNBILLED padahal cluster sudah DONE atau tanggal implementasi lewat 30 hari;
   *  - INVOICED/PAID tanpa tanggal invoice, atau PAID tanpa tanggal diterima.
   * Dikelompokkan per project.
   */
  async incomplete(user: AuthUser, projectId?: string) {
    const today = new Date(`${todayJakartaIso()}T00:00:00Z`);
    const cutoff = new Date(today.getTime() - 30 * 86_400_000);
    const rows = await this.prisma.clientPayment.findMany({
      where: {
        cluster: { ...this.access.clusterWhere(user), status: { not: 'CANCELLED' }, ...(projectId ? { projectId } : {}) },
        OR: [
          { status: 'UNBILLED', cluster: { OR: [{ status: 'DONE' }, { implementationDate: { lte: cutoff } }] } },
          { status: { in: ['INVOICED', 'PAID'] }, invoiceDate: null },
          { status: 'PAID', paidDate: null },
        ],
      },
      include: { cluster: { include: { project: true } }, po: true },
      orderBy: [{ cluster: { project: { code: 'asc' } } }, { cluster: { sortOrder: 'asc' } }, { kind: 'asc' }, { termin: 'asc' }],
    });
    const reasonOf = (p: (typeof rows)[number]) => {
      const r: string[] = [];
      if (p.status === 'UNBILLED') {
        if (p.cluster.status === 'DONE') r.push('cluster selesai, termin belum ditagih');
        else r.push(`implementasi ${p.cluster.implementationDate?.toISOString().slice(0, 10)} lewat 30 hari, belum ditagih`);
      }
      if (p.status !== 'UNBILLED' && !p.invoiceDate) r.push('tanggal invoice belum diisi');
      if (p.status === 'PAID' && !p.paidDate) r.push('tanggal diterima belum diisi');
      return r;
    };
    const groups = new Map<string, { projectId: string; projectCode: string; items: unknown[]; total: ReturnType<typeof dec> }>();
    for (const p of rows) {
      const g = groups.get(p.cluster.projectId) ?? { projectId: p.cluster.projectId, projectCode: p.cluster.project.code, items: [], total: dec(0) };
      g.items.push({
        ...paymentDto(p),
        clusterName: p.cluster.name,
        clusterStatus: p.cluster.status,
        implementationDate: p.cluster.implementationDate?.toISOString().slice(0, 10) ?? null,
        poNumber: p.po?.poNumber ?? null,
        poSubKind: p.po?.subKind ?? null,
        reasons: reasonOf(p),
      });
      g.total = g.total.plus(p.amount.toString());
      groups.set(p.cluster.projectId, g);
    }
    return [...groups.values()].map((g) => ({ ...g, count: g.items.length, total: moneyStr(g.total) }));
  }

  /** Expense PAJAK otomatis sebesar potongan pembayaran = DPP + PPN − diterima. */
  async syncTaxExpense(tx: Tx, p: ClientPayment, userId: string | null) {
    const sourceRef = `CLIENT_PAYMENT:${p.id}`;
    const existing = await tx.expense.findUnique({ where: { sourceRef }, include: { allocations: true } });
    const deduction = p.status === 'PAID' ? paymentDeduction(paymentTax(p).invoiceTotal, p.paidAmount?.toString()) : null;
    if (!deduction || deduction.isZero()) {
      if (existing) {
        await tx.expense.delete({ where: { id: existing.id } });
        await this.audit.diff(tx, userId, 'Expense', existing.id, { amount: s(existing.amount), status: existing.status }, { amount: null, status: 'DIHAPUS' });
      }
      return;
    }
    const cluster = await tx.cluster.findUniqueOrThrow({ where: { id: p.clusterId } });
    const budgetCode = await this.support.resolveBudgetCode(cluster.projectId, 'PAJAK', null, tx);
    const description = `Potongan pembayaran klien ${PO_KIND_LABEL[p.kind].toLowerCase()} termin ${p.termin}${p.invoiceNo ? ` (${p.invoiceNo})` : ''}`;
    const data = {
      projectId: cluster.projectId,
      clusterId: cluster.id,
      date: p.paidDate,
      category: 'PAJAK' as const,
      budgetCode,
      description,
      amount: money(deduction),
      invoiceNo: p.invoiceNo,
      status: 'TERVERIFIKASI' as const,
      source: 'CLIENT_PAYMENT' as const,
      verifiedById: userId,
      verifiedAt: new Date(),
    };
    const e = existing
      ? await tx.expense.update({ where: { id: existing.id }, data })
      : await tx.expense.create({ data: { ...data, sourceRef, createdById: userId } });
    await this.support.writeAllocations(tx, e.id, [{ clusterId: cluster.id, amount: deduction, pct: '1' }]);
    await this.audit.diff(tx, userId, 'Expense', e.id, existing ? { amount: s(existing.amount) } : null, { amount: deduction.toFixed(2), source: 'CLIENT_PAYMENT' });
  }

  /** Tambah termin manual pada satu PO (mis. CCSI yang belum punya template). */
  async create(user: AuthUser, clusterId: string, input: { poId: string; termin: number; amount: string; pct?: string | null; keterangan?: string | null }) {
    await this.access.assertCluster(user, clusterId);
    const po = await this.prisma.clusterPo.findUnique({ where: { id: input.poId } });
    if (!po || po.clusterId !== clusterId) throw new NotFoundException('PO tidak ditemukan di cluster ini');
    if ((ADJUSTMENT_PO_KINDS as readonly string[]).includes(po.kind)) {
      throw new BadRequestException('PO addwork/deduction tidak punya termin sendiri — koreksi masuk ke termin 1 implementasi');
    }
    const tax = await terminTaxDefaults(this.prisma, clusterId);
    try {
      const p = await this.prisma.clientPayment.create({
        data: {
          clusterId,
          poId: po.id,
          fromTemplate: false,
          kind: po.kind,
          termin: input.termin,
          amount: money(input.amount),
          pct: input.pct ? rate(input.pct) : null,
          keterangan: input.keterangan ?? null,
          ...tax,
        },
      });
      await this.audit.diff(this.prisma, user.id, 'ClientPayment', p.id, null, flat(p)!);
      return paymentDto(p);
    } catch {
      throw new ConflictException(`Termin ke-${input.termin} untuk PO ini sudah ada`);
    }
  }

  async remove(user: AuthUser, id: string) {
    const p = await this.prisma.clientPayment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Termin tidak ditemukan');
    await this.access.assertCluster(user, p.clusterId);
    if (p.status !== 'UNBILLED') throw new ConflictException('Hanya termin yang belum ditagih yang bisa dihapus');
    await this.prisma.clientPayment.delete({ where: { id } });
    await this.audit.diff(this.prisma, user.id, 'ClientPayment', id, flat(p), { status: 'DIHAPUS' });
    return { ok: true };
  }

  /** Generate termin dari template (insert-only). */
  async generate(user: AuthUser, clusterId: string) {
    await this.access.assertCluster(user, clusterId);
    return { created: await this.prisma.$transaction((tx) => generateClientPayments(tx, clusterId)) };
  }

  /** Hitung ulang (preview / terapkan) — lihat {@link recalcCluster}. */
  async recalculate(user: AuthUser, clusterId: string, apply: boolean) {
    await this.access.assertCluster(user, clusterId);
    if (!apply) return recalcCluster(this.prisma, this.audit, user.id, clusterId, false);
    const res = await this.prisma.$transaction((tx) => recalcCluster(tx, this.audit, user.id, clusterId, true));
    const failed = res.kinds.find((k) => k.error);
    if (failed) throw new ConflictException(failed.error);
    return res;
  }
}

type Diff = { id: string | null; termin: number; status: string; oldAmount: string | null; newAmount: string; changed: boolean; deleted?: boolean };

/**
 * Hitung ulang termin per PO setelah nilai PO berubah. Dipakai endpoint (preview/terapkan) dan laporan.
 * - Termin INVOICED/PAID tidak berubah; termin UNBILLED dihitung ulang dari persentase (template untuk
 *   IMPLEMENTASI/PERMIT, atau % termin manual yang ada); termin UNBILLED terakhir menerima selisih pembulatan.
 * - Fase 2.4: Σ ADDWORK + DEDUCTION mengoreksi TERMIN 1 PO implementasi utama. Bila termin 1 sudah ditagih/dibayar,
 *   koreksi masuk ke termin UNBILLED berikutnya + peringatan. Termin terpisah milik PO addwork/deduction dihapus.
 * `apply=false` → hanya preview diff.
 */
export async function recalcCluster(db: Db, audit: AuditService, userId: string | null, clusterId: string, apply: boolean) {
  if (apply) await ensureClusterPos(db, clusterId);
  const c = await db.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
  const templates = await db.terminTemplate.findMany({ where: { clientId: c.project.clientId }, include: { lines: true } });
  const pos = await db.clusterPo.findMany({ where: { clusterId }, orderBy: { createdAt: 'asc' } });
  const primary = primaryImplPo(pos);
  const adj = adjustmentSum(pos);
  const tax = apply ? await terminTaxDefaults(db, clusterId) : null;
  const kinds: {
    poId: string;
    poNumber: string | null;
    kind: string;
    base: string;
    adjustment: string;
    target: string;
    lockedSum: string;
    error: string | null;
    warning: string | null;
    diffs: Diff[];
  }[] = [];

  for (const po of pos) {
    const existing = await db.clientPayment.findMany({ where: { poId: po.id }, orderBy: { termin: 'asc' } });
    // PO addwork/deduction: termin terpisah (aturan 2.3) dihapus — koreksi pindah ke termin 1 implementasi
    if ((ADJUSTMENT_PO_KINDS as readonly string[]).includes(po.kind)) {
      if (!existing.length) continue;
      const billed = existing.filter((p) => p.status !== 'UNBILLED');
      kinds.push({
        poId: po.id,
        poNumber: po.poNumber,
        kind: po.kind,
        base: po.amount.toFixed(2),
        adjustment: '0.00',
        target: '0.00',
        lockedSum: '0.00',
        error: billed.length ? `Termin ${PO_KIND_LABEL[po.kind]} sudah ditagih/dibayar — selesaikan manual` : null,
        warning: null,
        diffs: existing.map((p) => ({ id: p.id, termin: p.termin, status: p.status, oldAmount: p.amount.toFixed(2), newAmount: '0.00', changed: true, deleted: true })),
      });
      continue;
    }
    const tpl = templates.find((t) => t.kind === po.kind && (TEMPLATE_PO_KINDS as readonly string[]).includes(po.kind));
    let lines: { terminKe: number; pct: string; keterangan: string | null }[];
    if (tpl?.lines.length) lines = tpl.lines.map((l) => ({ terminKe: l.terminKe, pct: l.pct.toString(), keterangan: l.keterangan }));
    else if (existing.length && existing.every((p) => p.pct) && sum(existing.map((p) => p.pct!.toString())).eq(1)) {
      lines = existing.map((p) => ({ terminKe: p.termin, pct: p.pct!.toString(), keterangan: p.keterangan }));
    } else continue; // tanpa template & tanpa % termin → tidak bisa dihitung ulang
    const ideal = generateTermins(lines, po.amount.toString());
    const rows = ideal.map((i) => {
      const p = existing.find((x) => x.termin === i.terminKe);
      return { terminKe: i.terminKe, pct: i.pct, keterangan: i.keterangan, payment: p ?? null, idealAmount: i.amount };
    });
    const isUnbilled = (r: (typeof rows)[number]) => !r.payment || r.payment.status === 'UNBILLED';
    let warning: string | null = null;
    const myAdj = primary?.id === po.id ? adj : sum([]);
    if (!myAdj.isZero() && rows.length) {
      const t1 = rows[0];
      const target = isUnbilled(t1) ? t1 : rows.slice(1).find(isUnbilled);
      if (target) {
        target.idealAmount = target.idealAmount.plus(myAdj);
        if (target !== t1) warning = `Termin 1 sudah ${t1.payment!.status === 'PAID' ? 'dibayar' : 'ditagih'} — koreksi addwork/deduction Rp ${moneyStr(myAdj)} masuk ke termin ${target.terminKe}`;
      }
    }
    const targetSum = sum(ideal.map((i) => i.amount)).plus(myAdj);
    const locked = existing.filter((p) => p.status !== 'UNBILLED');
    const lockedSum = sum(locked.map((p) => p.amount.toString()));
    const unbilled = rows.filter(isUnbilled);
    const diffs: Diff[] = [];
    let error: string | null = null;
    if (!unbilled.length) {
      if (!lockedSum.eq(targetSum)) error = 'Semua termin sudah ditagih/dibayar — selisih tidak bisa dialokasikan';
    } else {
      const others = unbilled.slice(0, -1);
      const remaining = targetSum.minus(lockedSum).minus(sum(others.map((r) => r.idealAmount)));
      if (targetSum.isPositive() ? remaining.isNegative() : remaining.isPositive()) error = 'Nilai PO baru lebih kecil dari termin yang sudah ditagih/dibayar';
      unbilled.forEach((r, i) => {
        const amount = i === unbilled.length - 1 ? remaining : r.idealAmount;
        diffs.push({
          id: r.payment?.id ?? null,
          termin: r.terminKe,
          status: r.payment?.status ?? 'BARU',
          oldAmount: r.payment ? r.payment.amount.toFixed(2) : null,
          newAmount: amount.toFixed(2),
          changed: !r.payment || !r.payment.amount.eq(amount.toFixed(2)),
        });
      });
    }
    for (const p of locked) diffs.push({ id: p.id, termin: p.termin, status: p.status, oldAmount: p.amount.toFixed(2), newAmount: p.amount.toFixed(2), changed: false });
    diffs.sort((a, b) => a.termin - b.termin);
    kinds.push({
      poId: po.id,
      poNumber: po.poNumber,
      kind: po.kind,
      base: po.amount.toFixed(2),
      adjustment: myAdj.toFixed(2),
      target: targetSum.toFixed(2),
      lockedSum: lockedSum.toFixed(2),
      error,
      warning,
      diffs,
    });

    if (apply && !error) {
      for (const d of diffs.filter((x) => x.changed)) {
        if (d.id) {
          await db.clientPayment.update({ where: { id: d.id }, data: { amount: money(d.newAmount) } });
          await audit.diff(db, userId, 'ClientPayment', d.id, { amount: d.oldAmount }, { amount: d.newAmount, sumber: 'hitung-ulang-termin' });
        } else {
          const r = rows.find((x) => x.terminKe === d.termin)!;
          const p = await db.clientPayment.create({
            data: {
              clusterId,
              poId: po.id,
              fromTemplate: !!tpl,
              kind: po.kind,
              termin: d.termin,
              pct: rate(r.pct),
              amount: money(d.newAmount),
              keterangan: r.keterangan,
              retentionMonths: tpl?.lines.find((l) => l.terminKe === d.termin)?.retentionMonths ?? null,
              ...tax!,
            },
          });
          await audit.diff(db, userId, 'ClientPayment', p.id, null, { amount: d.newAmount, sumber: 'hitung-ulang-termin' });
        }
      }
    }
  }
  if (apply && kinds.every((k) => !k.error)) {
    for (const k of kinds.filter((x) => x.diffs.some((d) => d.deleted))) {
      for (const d of k.diffs.filter((x) => x.deleted)) {
        await db.clientPayment.delete({ where: { id: d.id! } });
        await audit.diff(db, userId, 'ClientPayment', d.id!, { amount: d.oldAmount, status: d.status }, { status: 'DIHAPUS', sumber: 'koreksi addwork/deduction ke termin 1' });
      }
    }
  }
  return { applied: apply && kinds.every((k) => !k.error), kinds };
}
