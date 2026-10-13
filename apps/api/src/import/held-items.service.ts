import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ImportHeldItem } from '@prisma/client';
import type { HeldReleaseInput } from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { ExpenseSupportService } from '../realization/expense-support.service';
import { flatExpense } from '../realization/expenses.service';
import type { AuthUser } from '../auth/auth.types';
import { s } from '../common/decimal';
import { descOf, saveRule } from './rab-importer';
import { scanOverruns } from '../notifications/overrun';

/**
 * Lepas item ditahan (biaya) → expense TERVERIFIKASI dengan sourceRef yang sama + aturan item diperbarui,
 * sehingga import RAB berikutnya menganggap item ini UNCHANGED. Dipakai endpoint lepas & patch keputusan.
 */
export async function releaseHeldExpense(
  tx: Tx,
  audit: AuditService,
  support: ExpenseSupportService,
  h: ImportHeldItem,
  input: HeldReleaseInput,
  userId: string | null,
) {
  const alloc = await support.computeGroup(
    [h.amount.toString()],
    input.scope === 'CLUSTER'
      ? { projectId: h.projectId, clusterId: input.clusterId }
      : { projectId: h.projectId, clusterIds: input.clusterIds, method: input.method, manualPcts: input.manualPcts },
    tx,
  );
  const budgetCode = await support.resolveBudgetCode(h.projectId, input.category, null, tx);
  const note = input.note ?? null;
  const e = await tx.expense.create({
    data: {
      projectId: h.projectId,
      clusterId: input.scope === 'CLUSTER' ? input.clusterId! : null,
      date: h.date,
      periodLabel: h.periodLabel,
      category: input.category,
      budgetCode,
      description: descOf(h),
      amount: h.amount,
      note,
      allocationMethod: input.scope === 'PROJECT' ? alloc.method : null,
      status: 'TERVERIFIKASI',
      source: 'IMPORT_RAB',
      sourceRef: h.sourceRef,
      createdById: userId,
      verifiedById: userId,
      verifiedAt: new Date(),
    },
  });
  await support.writeAllocations(tx, e.id, alloc.lines[0]);
  await saveRule(tx, audit, h.sourceRef, h.projectId, { ...input, note }, userId);
  await tx.importHeldItem.update({ where: { id: h.id }, data: { status: 'RELEASED', expenseId: e.id, resolvedById: userId, resolvedAt: new Date() } });
  const after = await tx.expense.findUniqueOrThrow({ where: { id: e.id }, include: { allocations: true } });
  await audit.diff(tx, userId, 'Expense', e.id, null, { ...flatExpense(after)!, source: `lepas-ditahan:${h.sourceRef}` });
  await audit.diff(tx, userId, 'ImportHeldItem', h.id, { status: 'HELD' }, { status: 'RELEASED' });
  return e;
}

function dto(h: ImportHeldItem & { project?: { code: string } }) {
  return {
    id: h.id,
    sourceRef: h.sourceRef,
    projectId: h.projectId,
    projectCode: h.project?.code ?? null,
    sheet: h.sheet,
    cell: h.cell,
    section: h.section,
    blockTitle: h.blockTitle,
    groupTitle: h.groupTitle,
    label: h.label,
    date: h.date ? h.date.toISOString().slice(0, 10) : null,
    periodLabel: h.periodLabel,
    amount: s(h.amount)!,
    suggestedCategory: h.suggestedCategory,
    suggestedTarget: h.suggestedTarget,
    status: h.status,
    kind: h.kind,
    resolution: h.resolution,
    note: h.note,
    expenseId: h.expenseId,
    resolvedAt: h.resolvedAt,
  };
}

/**
 * Daftar "Ditahan — perlu konfirmasi" dari import RAB. Item bisa dilepas (dibuat expense TERVERIFIKASI
 * dengan sourceRef yang sama, sehingga import berikutnya UNCHANGED) atau ditandai lewati/duplikat,
 * tanpa perlu mengunggah ulang file.
 */
@Injectable()
export class HeldItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly support: ExpenseSupportService,
  ) {}

  async list(user: AuthUser, status = 'HELD') {
    const rows = await this.prisma.importHeldItem.findMany({
      where: { status, ...(this.access.isRestricted(user) ? { projectId: { in: (await this.prisma.project.findMany({ where: this.access.projectWhere(user), select: { id: true } })).map((p) => p.id) } } : {}) },
      orderBy: [{ sheet: 'asc' }, { createdAt: 'asc' }],
    });
    const projects = new Map((await this.prisma.project.findMany({ select: { id: true, code: true } })).map((p) => [p.id, p]));
    return rows.map((h) => dto({ ...h, project: projects.get(h.projectId) }));
  }

  private async loadHeld(user: AuthUser, id: string) {
    const h = await this.prisma.importHeldItem.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('Item ditahan tidak ditemukan');
    await this.access.assertProject(user, h.projectId);
    if (h.status !== 'HELD') throw new ConflictException('Item ini sudah diselesaikan');
    return h;
  }

  /** Batalkan keputusan duplikat/lewati → kembali ke daftar ditahan (aturan menjadi HOLD). */
  async reopen(user: AuthUser, id: string) {
    const h = await this.prisma.importHeldItem.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('Item tidak ditemukan');
    await this.access.assertProject(user, h.projectId);
    if (h.status !== 'DISMISSED') throw new ConflictException('Hanya item duplikat/dilewati yang bisa dibatalkan');
    await this.prisma.$transaction(async (tx) => {
      const note = `Dibuka kembali (sebelumnya ${h.resolution === 'DUPLICATE' ? 'duplikat' : 'dilewati'}: ${h.note ?? '-'})`;
      if (h.kind === 'EXPENSE' && !h.sourceRef.startsWith('MANUAL:')) await saveRule(tx, this.audit, h.sourceRef, h.projectId, { scope: 'HOLD', note }, user.id);
      await tx.importHeldItem.update({ where: { id }, data: { status: 'HELD', resolution: null, note, resolvedById: null, resolvedAt: null } });
      await this.audit.diff(tx, user.id, 'ImportHeldItem', id, { status: h.status, resolution: h.resolution }, { status: 'HELD', resolution: null });
    });
    return dto(await this.prisma.importHeldItem.findUniqueOrThrow({ where: { id } }));
  }

  async release(user: AuthUser, id: string, input: HeldReleaseInput) {
    const h = await this.loadHeld(user, id);
    if (h.kind !== 'EXPENSE') throw new ConflictException('Item ini pendapatan/PO, bukan biaya — tindak lanjut manual di budget / termin klien');
    await this.prisma.$transaction((tx) => releaseHeldExpense(tx, this.audit, this.support, h, input, user.id));
    await scanOverruns(this.prisma, (await this.prisma.cluster.findMany({ where: { projectId: h.projectId }, select: { id: true } })).map((c) => c.id));
    return dto((await this.prisma.importHeldItem.findUniqueOrThrow({ where: { id } })));
  }

  /** Tandai lewati / duplikat (tidak diimpor). */
  async dismiss(user: AuthUser, id: string, input: { scope: 'SKIP' | 'DUPLICATE'; note: string }) {
    const h = await this.loadHeld(user, id);
    await this.prisma.$transaction(async (tx) => {
      if (!h.sourceRef.startsWith('MANUAL:')) await saveRule(tx, this.audit, h.sourceRef, h.projectId, { scope: input.scope, note: input.note }, user.id);
      await tx.importHeldItem.update({ where: { id }, data: { status: 'DISMISSED', resolution: input.scope, note: input.note, resolvedById: user.id, resolvedAt: new Date() } });
      await this.audit.diff(tx, user.id, 'ImportHeldItem', id, { status: 'HELD' }, { status: `DISMISSED:${input.scope}` });
    });
    return dto((await this.prisma.importHeldItem.findUniqueOrThrow({ where: { id } })));
  }
}
