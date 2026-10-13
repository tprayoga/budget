import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClientInvoiceRef, ClientPayment, ClientPaymentStatus, Prisma, TerminKind } from '@prisma/client';
import {
  calcDueDate,
  dec,
  generateTermins,
  paymentDeduction,
  PO_KIND_LABEL,
  sum,
  type ApplyInvoiceRefInput,
  type ClientPaymentUpdateInput,
} from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../auth/auth.types';
import { money, rate, s } from '../common/decimal';
import { ExpenseSupportService } from './expense-support.service';
import { generateClientPayments, TEMPLATE_PO_KINDS } from './termin-generator';
import { ensureClusterPos, poDto } from '../clusters/po-support';
import { scanOverruns } from '../notifications/overrun';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (v: string) => new Date(`${v}T00:00:00Z`);

/**
 * Tanggal invoice belum diisi: termin sudah ditagih / punya nomor invoice / termin manual, tapi invoiceDate kosong.
 * (Tanggal tidak pernah ditebak — dibiarkan kosong sampai FINANCE mengisi.)
 */
export function needsInvoiceDate(p: Pick<ClientPayment, 'invoiceDate' | 'status' | 'invoiceNo' | 'fromTemplate'>) {
  return !p.invoiceDate && (p.status !== 'UNBILLED' || !!p.invoiceNo || !p.fromTemplate);
}
export const NEEDS_INVOICE_DATE_WHERE: Prisma.ClientPaymentWhereInput = {
  invoiceDate: null,
  OR: [{ status: { not: 'UNBILLED' } }, { invoiceNo: { not: null } }, { fromTemplate: false }],
};

function refDto(r: ClientInvoiceRef) {
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
  };
}

function dto(p: ClientPayment) {
  return {
    id: p.id,
    clusterId: p.clusterId,
    poId: p.poId,
    fromTemplate: p.fromTemplate,
    needsInvoiceDate: needsInvoiceDate(p),
    kind: p.kind,
    termin: p.termin,
    pct: s(p.pct),
    amount: s(p.amount)!,
    keterangan: p.keterangan,
    invoiceNo: p.invoiceNo,
    invoiceDate: iso(p.invoiceDate),
    dueDate: iso(p.dueDate),
    paidDate: iso(p.paidDate),
    paidAmount: s(p.paidAmount),
    potongan: paymentDeduction(p.amount.toString(), p.status === 'PAID' ? p.paidAmount?.toString() : null).toFixed(2),
    status: p.status,
    updatedAt: p.updatedAt,
  };
}

function flat(p: ClientPayment | null) {
  if (!p) return null;
  return {
    amount: s(p.amount),
    invoiceNo: p.invoiceNo,
    invoiceDate: iso(p.invoiceDate),
    dueDate: iso(p.dueDate),
    paidDate: iso(p.paidDate),
    paidAmount: s(p.paidAmount),
    status: p.status,
    keterangan: p.keterangan,
  };
}

/**
 * Termin pembayaran klien per cluster.
 * - Jatuh tempo dihitung dari template aging (kalender / hari kerja melewati Sabtu, Minggu, HariLibur).
 * - Bila status PAID dan paidAmount < amount (bruto), selisihnya otomatis menjadi expense PAJAK
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

  /** Termin per PO + referensi tagihan RAB (cluster ini, atau tingkat project tanpa cluster). */
  async list(user: AuthUser, clusterId: string) {
    await this.access.assertCluster(user, clusterId);
    const rows = await this.prisma.clientPayment.findMany({ where: { clusterId }, orderBy: [{ kind: 'asc' }, { termin: 'asc' }] });
    const c = await this.prisma.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
    const templates = await this.prisma.terminTemplate.findMany({ where: { clientId: c.project.clientId }, include: { lines: true } });
    const pos = await this.prisma.clusterPo.findMany({ where: { clusterId }, orderBy: { createdAt: 'asc' } });
    const refs = await this.prisma.clientInvoiceRef.findMany({
      where: { projectId: c.projectId, OR: [{ clusterId }, { clusterId: null }] },
      orderBy: [{ blockTitle: 'asc' }, { termin: 'asc' }, { invoiceNo: 'asc' }],
    });
    return {
      pos: pos.map(poDto),
      payments: rows.map(dto),
      templates: templates.map((t) => ({ kind: t.kind, agingDays: t.agingDays, agingType: t.agingType, lines: t.lines.length })),
      invoiceRefs: refs.map(refDto),
      missingInvoiceDate: rows.filter(needsInvoiceDate).length,
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

  /** Status mengikuti data: ada paidDate & paidAmount → PAID; ada invoiceDate → INVOICED; selain itu UNBILLED. */
  private deriveStatus(p: { invoiceDate: Date | null; paidDate: Date | null; paidAmount: Prisma.Decimal | null }): ClientPaymentStatus {
    if (p.paidDate && p.paidAmount) return 'PAID';
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
      if (paidAmount && paidAmount.gt(amount)) throw new BadRequestException('Nominal diterima melebihi nilai bruto termin');

      let dueDate = before.dueDate;
      if (tpl?.agingDays != null && tpl.agingType) {
        dueDate = invoiceDate ? calcDueDate(invoiceDate, tpl.agingDays, tpl.agingType, await this.holidays(tx)) : null;
      } else if (input.dueDate !== undefined) {
        dueDate = input.dueDate ? day(input.dueDate) : null;
      }
      let status = this.deriveStatus({ invoiceDate, paidDate, paidAmount });
      if (input.status && input.status !== status) {
        if (input.status === 'PAID' && !(paidDate && paidAmount)) throw new BadRequestException('Status Dibayar wajib tanggal & nominal diterima');
        if (input.status === 'INVOICED' && !invoiceDate) throw new BadRequestException('Status Ditagih wajib tanggal invoice');
        status = input.status;
      }

      const after = await tx.clientPayment.update({
        where: { id },
        data: {
          amount,
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
    return dto(result);
  }

  /**
   * Terapkan referensi tagihan RAB ke termin (dikonfirmasi FINANCE, tidak pernah otomatis):
   * bruto = isian FINANCE, paidAmount = nilai net referensi, invoiceNo & jatuh tempo dari referensi.
   * Referensi Paid → status PAID (potongan bruto − net otomatis jadi expense PAJAK); Unpaid → INVOICED.
   * Tanggal invoice tidak diisi dari referensi (RAB tidak memuatnya).
   */
  async applyReference(user: AuthUser, paymentId: string, input: ApplyInvoiceRefInput) {
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.clientPayment.findUnique({ where: { id: paymentId } });
      if (!before) throw new NotFoundException('Termin tidak ditemukan');
      const c = await this.access.assertCluster(user, before.clusterId);
      const ref = await tx.clientInvoiceRef.findUnique({ where: { id: input.refId } });
      if (!ref || ref.projectId !== c.projectId || (ref.clusterId && ref.clusterId !== before.clusterId)) {
        throw new NotFoundException('Referensi tagihan tidak ditemukan untuk cluster ini');
      }
      if (ref.appliedPaymentId) throw new ConflictException('Referensi ini sudah diterapkan ke termin lain');
      const amount = money(input.amount);
      const net = ref.netAmount;
      if (ref.paid && !net) throw new BadRequestException('Referensi Paid tanpa nilai net — isi termin manual');
      if (net && net.gt(amount)) throw new BadRequestException('Bruto harus ≥ nilai net referensi');
      const paid = ref.paid && !!net;
      const paidDate = paid ? (input.paidDate ? day(input.paidDate) : ref.dueDate) : null;
      if (paid && !paidDate) throw new BadRequestException('Tanggal diterima wajib diisi (referensi tidak punya jatuh tempo)');
      const after = await tx.clientPayment.update({
        where: { id: paymentId },
        data: {
          amount,
          invoiceNo: ref.invoiceNo,
          dueDate: ref.dueDate ?? before.dueDate,
          paidAmount: paid ? net : null,
          paidDate,
          status: paid ? 'PAID' : 'INVOICED',
        },
      });
      await tx.clientInvoiceRef.update({ where: { id: ref.id }, data: { appliedPaymentId: paymentId, appliedAt: new Date(), appliedById: user.id } });
      await this.audit.diff(tx, user.id, 'ClientPayment', paymentId, flat(before), { ...flat(after)!, sumber: `referensi RAB ${ref.sourceRef}` });
      await this.syncTaxExpense(tx, after, user.id);
      return after;
    });
    await scanOverruns(this.prisma, [result.clusterId]);
    return dto(result);
  }

  /** Expense PAJAK otomatis sebesar potongan pembayaran (bruto − diterima). */
  async syncTaxExpense(tx: Tx, p: ClientPayment, userId: string | null) {
    const sourceRef = `CLIENT_PAYMENT:${p.id}`;
    const existing = await tx.expense.findUnique({ where: { sourceRef }, include: { allocations: true } });
    const deduction = p.status === 'PAID' ? paymentDeduction(p.amount.toString(), p.paidAmount?.toString()) : null;
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
        },
      });
      await this.audit.diff(this.prisma, user.id, 'ClientPayment', p.id, null, flat(p)!);
      return dto(p);
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

  /**
   * Hitung ulang termin per PO setelah nilai PO berubah. Termin INVOICED/PAID tidak berubah; termin UNBILLED dihitung
   * ulang dari persentase (template untuk IMPLEMENTASI/PERMIT, atau % termin manual yang ada) dan termin UNBILLED
   * terakhir menerima selisih sehingga Σ termin = Σpct × nilai PO. `apply=false` → hanya preview diff.
   */
  async recalculate(user: AuthUser, clusterId: string, apply: boolean) {
    await this.access.assertCluster(user, clusterId);
    const run = async (tx: Tx) => {
      if (apply) await ensureClusterPos(tx, clusterId);
      const c = await tx.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
      const templates = await tx.terminTemplate.findMany({ where: { clientId: c.project.clientId }, include: { lines: true } });
      const pos = await tx.clusterPo.findMany({ where: { clusterId }, orderBy: { createdAt: 'asc' } });
      const kinds = [];
      for (const po of pos) {
        const existing = await tx.clientPayment.findMany({ where: { poId: po.id }, orderBy: { termin: 'asc' } });
        const tpl = templates.find((t) => t.kind === po.kind && (TEMPLATE_PO_KINDS as readonly string[]).includes(po.kind));
        let lines: { terminKe: number; pct: string; keterangan: string | null }[];
        if (tpl?.lines.length) lines = tpl.lines.map((l) => ({ terminKe: l.terminKe, pct: l.pct.toString(), keterangan: l.keterangan }));
        else if (existing.length && existing.every((p) => p.pct) && sum(existing.map((p) => p.pct!.toString())).eq(1)) {
          lines = existing.map((p) => ({ terminKe: p.termin, pct: p.pct!.toString(), keterangan: p.keterangan }));
        } else continue; // tanpa template & tanpa % termin → tidak bisa dihitung ulang
        const base = po.amount;
        const ideal = generateTermins(lines, base.toString());
        const target = sum(ideal.map((i) => i.amount));
        const locked = existing.filter((p) => p.status !== 'UNBILLED');
        const lockedSum = sum(locked.map((p) => p.amount.toString()));
        const rows = ideal.map((i) => {
          const p = existing.find((x) => x.termin === i.terminKe);
          return { terminKe: i.terminKe, pct: i.pct, keterangan: i.keterangan, payment: p ?? null, idealAmount: i.amount };
        });
        const unbilled = rows.filter((r) => !r.payment || r.payment.status === 'UNBILLED');
        const diffs: { id: string | null; termin: number; status: string; oldAmount: string | null; newAmount: string; changed: boolean }[] = [];
        let error: string | null = null;
        if (!unbilled.length) {
          if (!lockedSum.eq(target)) error = 'Semua termin sudah ditagih/dibayar — selisih tidak bisa dialokasikan';
        } else {
          const others = unbilled.slice(0, -1);
          const remaining = target.minus(lockedSum).minus(sum(others.map((r) => r.idealAmount)));
          if (dec(target).isPositive() ? remaining.isNegative() : remaining.isPositive()) error = 'Nilai PO baru lebih kecil dari termin yang sudah ditagih/dibayar';
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
        kinds.push({ poId: po.id, poNumber: po.poNumber, kind: po.kind, base: base.toFixed(2), target: target.toFixed(2), lockedSum: lockedSum.toFixed(2), error, diffs });

        if (apply && !error) {
          for (const d of diffs.filter((x) => x.changed)) {
            if (d.id) {
              await tx.clientPayment.update({ where: { id: d.id }, data: { amount: money(d.newAmount) } });
              await this.audit.diff(tx, user.id, 'ClientPayment', d.id, { amount: d.oldAmount }, { amount: d.newAmount, sumber: 'hitung-ulang-termin' });
            } else {
              const r = rows.find((x) => x.terminKe === d.termin)!;
              const p = await tx.clientPayment.create({
                data: { clusterId, poId: po.id, fromTemplate: !!tpl, kind: po.kind, termin: d.termin, pct: rate(r.pct), amount: money(d.newAmount), keterangan: r.keterangan },
              });
              await this.audit.diff(tx, user.id, 'ClientPayment', p.id, null, { amount: d.newAmount, sumber: 'hitung-ulang-termin' });
            }
          }
        }
      }
      return { applied: apply && kinds.every((k) => !k.error), kinds };
    };
    if (!apply) return run(this.prisma as unknown as Tx);
    const res = await this.prisma.$transaction(run);
    const failed = res.kinds.find((k) => k.error);
    if (failed) throw new ConflictException(failed.error);
    return res;
  }
}
