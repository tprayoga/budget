import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClientPayment, ClientPaymentStatus, Prisma, TerminKind } from '@prisma/client';
import { calcDueDate, generateTermins, paymentDeduction, sum, type ClientPaymentUpdateInput } from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../auth/auth.types';
import { money, rate, s } from '../common/decimal';
import { ExpenseSupportService } from './expense-support.service';
import { generateClientPayments } from './termin-generator';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (v: string) => new Date(`${v}T00:00:00Z`);

function dto(p: ClientPayment) {
  return {
    id: p.id,
    clusterId: p.clusterId,
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

  async list(user: AuthUser, clusterId: string) {
    await this.access.assertCluster(user, clusterId);
    const rows = await this.prisma.clientPayment.findMany({ where: { clusterId }, orderBy: [{ kind: 'asc' }, { termin: 'asc' }] });
    const c = await this.prisma.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
    const templates = await this.prisma.terminTemplate.findMany({ where: { clientId: c.project.clientId }, include: { lines: true } });
    return {
      payments: rows.map(dto),
      templates: templates.map((t) => ({ kind: t.kind, agingDays: t.agingDays, agingType: t.agingType, lines: t.lines.length })),
    };
  }

  private async holidays(db: Tx | PrismaService) {
    return (await db.hariLibur.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10));
  }

  private async template(db: Tx | PrismaService, clusterId: string, kind: TerminKind) {
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
    const description = `Potongan pembayaran klien ${p.kind === 'PERMIT' ? 'permit' : 'implementasi'} termin ${p.termin}${p.invoiceNo ? ` (${p.invoiceNo})` : ''}`;
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

  /** Tambah termin manual (mis. CCSI yang belum punya template). */
  async create(user: AuthUser, clusterId: string, input: { kind: TerminKind; termin: number; amount: string; pct?: string | null; keterangan?: string | null }) {
    await this.access.assertCluster(user, clusterId);
    try {
      const p = await this.prisma.clientPayment.create({
        data: {
          clusterId,
          kind: input.kind,
          termin: input.termin,
          amount: money(input.amount),
          pct: input.pct ? rate(input.pct) : null,
          keterangan: input.keterangan ?? null,
        },
      });
      await this.audit.diff(this.prisma, user.id, 'ClientPayment', p.id, null, flat(p)!);
      return dto(p);
    } catch {
      throw new ConflictException(`Termin ${input.kind} ke-${input.termin} sudah ada`);
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
    return { created: await generateClientPayments(this.prisma, clusterId) };
  }

  /**
   * Hitung ulang termin setelah nilai PO berubah. Termin INVOICED/PAID tidak berubah; termin UNBILLED dihitung
   * ulang dari persentase template dan termin UNBILLED terakhir menerima selisih sehingga
   * Σ termin = Σpct × nilai PO terkini. `apply=false` → hanya preview diff.
   */
  async recalculate(user: AuthUser, clusterId: string, apply: boolean) {
    await this.access.assertCluster(user, clusterId);
    const run = async (tx: Tx) => {
      const c = await tx.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
      const templates = await tx.terminTemplate.findMany({ where: { clientId: c.project.clientId }, include: { lines: true } });
      const kinds = [];
      for (const t of templates) {
        const base = t.kind === 'PERMIT' ? c.nilaiPoPermit : c.nilaiPoImpl;
        const ideal = generateTermins(t.lines.map((l) => ({ terminKe: l.terminKe, pct: l.pct.toString(), keterangan: l.keterangan })), base.toString());
        const target = sum(ideal.map((i) => i.amount));
        const existing = await tx.clientPayment.findMany({ where: { clusterId, kind: t.kind }, orderBy: { termin: 'asc' } });
        const locked = existing.filter((p) => p.status !== 'UNBILLED');
        const lockedSum = sum(locked.map((p) => p.amount.toString()));
        // termin UNBILLED (yang ada + yang belum dibuat dari template)
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
          if (remaining.isNegative()) error = 'Nilai PO baru lebih kecil dari termin yang sudah ditagih/dibayar';
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
        kinds.push({ kind: t.kind, base: base.toFixed(2), target: target.toFixed(2), lockedSum: lockedSum.toFixed(2), error, diffs });

        if (apply && !error) {
          for (const d of diffs.filter((x) => x.changed)) {
            if (d.id) {
              await tx.clientPayment.update({ where: { id: d.id }, data: { amount: money(d.newAmount) } });
              await this.audit.diff(tx, user.id, 'ClientPayment', d.id, { amount: d.oldAmount }, { amount: d.newAmount, sumber: 'hitung-ulang-termin' });
            } else {
              const r = rows.find((x) => x.terminKe === d.termin)!;
              const p = await tx.clientPayment.create({
                data: { clusterId, kind: t.kind, termin: d.termin, pct: rate(r.pct), amount: money(d.newAmount), keterangan: r.keterangan },
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
