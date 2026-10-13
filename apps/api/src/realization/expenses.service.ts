import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ExpenseSource, ExpenseStatus, Prisma } from '@prisma/client';
import type { ExpenseCreateInput, ExpenseUpdateInput, Role } from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { StorageService, type UploadedFile } from '../storage/storage.service';
import type { AuthUser } from '../auth/auth.types';
import { money, s } from '../common/decimal';
import { ExpenseSupportService } from './expense-support.service';

export const EXPENSE_INCLUDE = {
  allocations: { include: { cluster: { select: { id: true, name: true } } } },
  cluster: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  verifiedBy: { select: { id: true, name: true } },
  apiKey: { select: { id: true, name: true } },
  fundRequest: { select: { id: true, number: true, status: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseFull = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

/** Role yang boleh mencatat realisasi. */
export const EXPENSE_WRITE_ROLES: Role[] = ['ADMIN', 'PM', 'FINANCE'];
/** Input FINANCE/ADMIN langsung terverifikasi; PM perlu verifikasi FINANCE. */
const autoVerified = (role: Role) => role === 'FINANCE' || role === 'ADMIN';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function expenseDto(e: ExpenseFull, clusterId?: string) {
  const own = clusterId ? e.allocations.find((a) => a.clusterId === clusterId) : null;
  return {
    id: e.id,
    project: e.project,
    cluster: e.cluster,
    date: iso(e.date),
    periodLabel: e.periodLabel,
    category: e.category,
    budgetCode: e.budgetCode,
    description: e.description,
    amount: s(e.amount)!,
    /** porsi untuk cluster yang diminta (bila difilter per cluster) */
    clusterAmount: own ? s(own.amount) : null,
    termin: e.termin,
    vendor: e.vendor,
    invoiceNo: e.invoiceNo,
    hasAttachment: !!e.attachmentUrl,
    attachmentName: e.attachmentName,
    fundRequest: e.fundRequest,
    status: e.status,
    source: e.source,
    sourceRef: e.sourceRef,
    allocationMethod: e.allocationMethod,
    allocations: e.allocations.map((a) => ({ clusterId: a.clusterId, clusterName: a.cluster.name, amount: s(a.amount)!, pct: s(a.pct)! })),
    rejectNote: e.rejectNote,
    createdBy: e.createdBy,
    apiKey: e.apiKey,
    verifiedBy: e.verifiedBy,
    verifiedAt: e.verifiedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    locked: e.source === 'CLIENT_PAYMENT',
  };
}

/** Representasi datar expense untuk audit log. */
export function flatExpense(e: (Prisma.ExpenseGetPayload<{ include: { allocations: true } }>) | null) {
  if (!e) return null;
  const o: Record<string, string | null> = {
    status: e.status,
    date: iso(e.date),
    category: e.category,
    budgetCode: e.budgetCode,
    description: e.description,
    amount: s(e.amount),
    clusterId: e.clusterId,
    allocationMethod: e.allocationMethod,
    fundRequestId: e.fundRequestId,
    vendor: e.vendor,
    invoiceNo: e.invoiceNo,
    termin: e.termin,
    attachmentName: e.attachmentName,
  };
  for (const a of e.allocations) o[`allocation.${a.clusterId}`] = s(a.amount);
  return o;
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly support: ExpenseSupportService,
  ) {}

  private where(user: AuthUser): Prisma.ExpenseWhereInput {
    return this.access.isRestricted(user) ? { project: this.access.projectWhere(user) } : {};
  }

  async list(
    user: AuthUser,
    q: { projectId?: string; clusterId?: string; status?: ExpenseStatus; category?: string; fundRequestId?: string; from?: string; to?: string; q?: string },
  ) {
    const rows = await this.prisma.expense.findMany({
      where: {
        ...this.where(user),
        projectId: q.projectId,
        status: q.status,
        category: q.category as Prisma.ExpenseWhereInput['category'],
        fundRequestId: q.fundRequestId,
        ...(q.clusterId ? { allocations: { some: { clusterId: q.clusterId } } } : {}),
        ...(q.from || q.to
          ? { date: { gte: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined, lte: q.to ? new Date(`${q.to}T00:00:00Z`) : undefined } }
          : {}),
        ...(q.q ? { OR: [{ description: { contains: q.q, mode: 'insensitive' } }, { vendor: { contains: q.q, mode: 'insensitive' } }] } : {}),
      },
      include: EXPENSE_INCLUDE,
      orderBy: [{ date: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 1000,
    });
    return rows.map((e) => expenseDto(e, q.clusterId));
  }

  async get(user: AuthUser, id: string) {
    return expenseDto(await this.load(user, id));
  }

  private async load(user: AuthUser, id: string, db: Tx | PrismaService = this.prisma): Promise<ExpenseFull> {
    const e = await db.expense.findFirst({ where: { id, ...this.where(user) }, include: EXPENSE_INCLUDE });
    if (!e) throw new NotFoundException('Realisasi tidak ditemukan');
    return e;
  }

  /** Validasi tautan ke pengajuan: harus DICAIRKAN dan cluster-nya termasuk alokasi expense. */
  private async assertFundRequest(db: Tx, fundRequestId: string | null | undefined, projectId: string, clusterIds: string[]) {
    if (!fundRequestId) return;
    const fr = await db.fundRequest.findUnique({ where: { id: fundRequestId }, include: { cluster: true } });
    if (!fr || fr.cluster.projectId !== projectId) throw new BadRequestException('Pengajuan tidak ditemukan di project ini');
    if (fr.status !== 'DICAIRKAN') throw new BadRequestException('Realisasi hanya bisa ditautkan ke pengajuan yang sudah DICAIRKAN');
    if (!clusterIds.includes(fr.clusterId)) throw new BadRequestException('Cluster pengajuan tidak termasuk alokasi realisasi ini');
  }

  async create(user: AuthUser, input: ExpenseCreateInput, file?: UploadedFile, source: ExpenseSource = 'MANUAL') {
    let projectId = input.projectId;
    if (input.clusterId) {
      const c = await this.access.assertCluster(user, input.clusterId);
      projectId = c.projectId;
    }
    if (!projectId) throw new BadRequestException('Pilih cluster atau project');
    await this.access.assertProject(user, projectId);
    const pid = projectId;

    const id = await this.prisma.$transaction(async (tx) => {
      const budgetCode = await this.support.resolveBudgetCode(pid, input.category, input.budgetCode, tx);
      const alloc = await this.support.computeGroup(
        [input.amount],
        {
          projectId: pid,
          clusterId: input.clusterId,
          clusterIds: input.clusterIds,
          method: input.allocationMethod,
          manualAllocations: input.manualAllocations,
        },
        tx,
      );
      const verified = autoVerified(user.role);
      const e = await tx.expense.create({
        data: {
          projectId: pid,
          clusterId: input.clusterId ?? null,
          date: new Date(`${input.date}T00:00:00Z`),
          category: input.category,
          budgetCode,
          description: input.description,
          amount: money(input.amount),
          termin: input.termin ?? null,
          vendor: input.vendor ?? null,
          invoiceNo: input.invoiceNo ?? null,
          status: verified ? 'TERVERIFIKASI' : 'PERLU_VERIFIKASI',
          verifiedById: verified ? user.id : null,
          verifiedAt: verified ? new Date() : null,
          source: input.source ?? source,
          allocationMethod: input.clusterId ? null : alloc.method,
          createdById: user.id,
        },
      });
      await this.support.writeAllocations(tx, e.id, alloc.lines[0]);
      await this.assertFundRequest(tx, input.fundRequestId, pid, alloc.lines[0].map((l) => l.clusterId));
      if (input.fundRequestId) await tx.expense.update({ where: { id: e.id }, data: { fundRequestId: input.fundRequestId } });
      if (file) {
        const stored = await this.storage.saveIn('expense', e.id, file);
        await tx.expense.update({ where: { id: e.id }, data: { attachmentUrl: stored.fileUrl, attachmentName: stored.fileName, attachmentMime: stored.mimeType } });
      }
      const after = await tx.expense.findUniqueOrThrow({ where: { id: e.id }, include: { allocations: true } });
      await this.audit.diff(tx, user.id, 'Expense', e.id, null, flatExpense(after)!);
      return e.id;
    });
    return this.get(user, id);
  }

  /** Hak ubah: FINANCE/ADMIN semua; PM hanya miliknya yang belum diverifikasi. Expense CLIENT_PAYMENT terkunci. */
  private assertEditable(user: AuthUser, e: { source: ExpenseSource; status: ExpenseStatus; createdById: string | null }) {
    if (e.source === 'CLIENT_PAYMENT') throw new ConflictException('Expense potongan pembayaran klien dikelola otomatis dari termin klien');
    if (autoVerified(user.role)) return;
    if (user.role === 'PM' && e.createdById === user.id && e.status !== 'TERVERIFIKASI') return;
    throw new ForbiddenException('Anda tidak dapat mengubah realisasi ini');
  }

  async update(user: AuthUser, id: string, input: ExpenseUpdateInput) {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.load(user, id, tx);
      this.assertEditable(user, before);
      const category = input.category ?? before.category;
      const budgetCode =
        input.budgetCode !== undefined || input.category !== undefined
          ? await this.support.resolveBudgetCode(before.projectId, category, input.budgetCode, tx)
          : before.budgetCode;
      const amount = input.amount ?? before.amount.toString();
      const clusterId = input.clusterId !== undefined ? input.clusterId : before.clusterId;
      const reallocate =
        input.amount !== undefined ||
        input.clusterId !== undefined ||
        input.clusterIds !== undefined ||
        input.allocationMethod !== undefined ||
        input.manualAllocations !== undefined;
      let clusterIds = before.allocations.map((a) => a.clusterId);
      let method = before.allocationMethod;
      if (reallocate) {
        const alloc = await this.support.computeGroup(
          [amount],
          {
            projectId: before.projectId,
            clusterId,
            clusterIds: input.clusterIds ?? (clusterId ? undefined : clusterIds),
            method: input.allocationMethod ?? before.allocationMethod,
            manualAllocations: input.manualAllocations,
          },
          tx,
        );
        await this.support.writeAllocations(tx, id, alloc.lines[0]);
        clusterIds = alloc.lines[0].map((l) => l.clusterId);
        method = clusterId ? null : alloc.method;
      }
      const fundRequestId = input.fundRequestId !== undefined ? input.fundRequestId : before.fundRequestId;
      await this.assertFundRequest(tx, fundRequestId, before.projectId, clusterIds);
      // PM yang mengubah expense DITOLAK → kembali menunggu verifikasi
      const resubmit = !autoVerified(user.role) && before.status === 'DITOLAK';
      await tx.expense.update({
        where: { id },
        data: {
          clusterId,
          date: input.date ? new Date(`${input.date}T00:00:00Z`) : undefined,
          category,
          budgetCode,
          description: input.description,
          amount: money(amount),
          termin: input.termin,
          vendor: input.vendor,
          invoiceNo: input.invoiceNo,
          fundRequestId,
          allocationMethod: method,
          ...(resubmit ? { status: 'PERLU_VERIFIKASI', rejectNote: null } : {}),
        },
      });
      const after = await tx.expense.findUniqueOrThrow({ where: { id }, include: { allocations: true } });
      await this.audit.diff(tx, user.id, 'Expense', id, flatExpense(before), flatExpense(after)!);
    });
    return this.get(user, id);
  }

  /** FINANCE memverifikasi expense PERLU_VERIFIKASI (mis. dari webhook / input PM). */
  async verify(user: AuthUser, id: string) {
    return this.decide(user, id, 'TERVERIFIKASI', null);
  }

  async reject(user: AuthUser, id: string, note: string) {
    return this.decide(user, id, 'DITOLAK', note);
  }

  private async decide(user: AuthUser, id: string, status: ExpenseStatus, note: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.load(user, id, tx);
      if (before.status !== 'PERLU_VERIFIKASI') throw new ConflictException('Hanya realisasi berstatus "Perlu verifikasi" yang bisa diputuskan');
      await tx.expense.update({
        where: { id },
        data: {
          status,
          rejectNote: note,
          verifiedById: status === 'TERVERIFIKASI' ? user.id : null,
          verifiedAt: status === 'TERVERIFIKASI' ? new Date() : null,
        },
      });
      const after = await tx.expense.findUniqueOrThrow({ where: { id }, include: { allocations: true } });
      await this.audit.diff(tx, user.id, 'Expense', id, flatExpense(before), { ...flatExpense(after)!, rejectNote: note });
    });
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const file = await this.prisma.$transaction(async (tx) => {
      const before = await this.load(user, id, tx);
      this.assertEditable(user, before);
      await tx.expense.delete({ where: { id } });
      await this.audit.diff(tx, user.id, 'Expense', id, flatExpense(before), { status: 'DIHAPUS' });
      return before.attachmentUrl;
    });
    if (file) await this.storage.remove(file);
    return { ok: true };
  }

  async setAttachment(user: AuthUser, id: string, file: UploadedFile) {
    const before = await this.load(user, id);
    this.assertEditable(user, before);
    const stored = await this.storage.saveIn('expense', id, file);
    await this.prisma.expense.update({
      where: { id },
      data: { attachmentUrl: stored.fileUrl, attachmentName: stored.fileName, attachmentMime: stored.mimeType },
    });
    if (before.attachmentUrl) await this.storage.remove(before.attachmentUrl);
    await this.audit.diff(this.prisma, user.id, 'Expense', id, { attachmentName: before.attachmentName }, { attachmentName: stored.fileName });
    return this.get(user, id);
  }

  async attachmentFile(user: AuthUser, id: string) {
    const e = await this.load(user, id);
    if (!e.attachmentUrl) throw new NotFoundException('Tidak ada foto/nota');
    return { path: this.storage.absolute(e.attachmentUrl), fileName: e.attachmentName ?? 'nota', mimeType: e.attachmentMime };
  }

  /** Antrean verifikasi FINANCE. */
  async pendingCount(user: AuthUser) {
    return this.prisma.expense.count({ where: { ...this.where(user), status: 'PERLU_VERIFIKASI' } });
  }
}
