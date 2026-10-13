import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ImportHeldItem } from '@prisma/client';
import type { HeldReleaseInput } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { ExpenseSupportService } from '../realization/expense-support.service';
import { flatExpense } from '../realization/expenses.service';
import type { AuthUser } from '../auth/auth.types';
import { s } from '../common/decimal';
import { descOf, saveRule } from './rab-importer';

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

  async release(user: AuthUser, id: string, input: HeldReleaseInput) {
    const h = await this.loadHeld(user, id);
    await this.prisma.$transaction(async (tx) => {
      const alloc = await this.support.computeGroup(
        [h.amount.toString()],
        input.scope === 'CLUSTER'
          ? { projectId: h.projectId, clusterId: input.clusterId }
          : { projectId: h.projectId, clusterIds: input.clusterIds, method: input.method, manualPcts: input.manualPcts },
        tx,
      );
      const budgetCode = await this.support.resolveBudgetCode(h.projectId, input.category, null, tx);
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
          createdById: user.id,
          verifiedById: user.id,
          verifiedAt: new Date(),
        },
      });
      await this.support.writeAllocations(tx, e.id, alloc.lines[0]);
      // aturan item diperbarui → import berikutnya menganggap item ini UNCHANGED
      await saveRule(tx, this.audit, h.sourceRef, h.projectId, { ...input, note }, user.id);
      await tx.importHeldItem.update({ where: { id }, data: { status: 'RELEASED', expenseId: e.id, resolvedById: user.id, resolvedAt: new Date() } });
      const after = await tx.expense.findUniqueOrThrow({ where: { id: e.id }, include: { allocations: true } });
      await this.audit.diff(tx, user.id, 'Expense', e.id, null, { ...flatExpense(after)!, source: `lepas-ditahan:${h.sourceRef}` });
      await this.audit.diff(tx, user.id, 'ImportHeldItem', id, { status: 'HELD' }, { status: 'RELEASED' });
    });
    return dto((await this.prisma.importHeldItem.findUniqueOrThrow({ where: { id } })));
  }

  /** Tandai lewati / duplikat (tidak diimpor). */
  async dismiss(user: AuthUser, id: string, input: { scope: 'SKIP' | 'DUPLICATE'; note: string }) {
    const h = await this.loadHeld(user, id);
    await this.prisma.$transaction(async (tx) => {
      await saveRule(tx, this.audit, h.sourceRef, h.projectId, { scope: input.scope, note: input.note }, user.id);
      await tx.importHeldItem.update({ where: { id }, data: { status: 'DISMISSED', note: input.note, resolvedById: user.id, resolvedAt: new Date() } });
      await this.audit.diff(tx, user.id, 'ImportHeldItem', id, { status: 'HELD' }, { status: `DISMISSED:${input.scope}` });
    });
    return dto((await this.prisma.importHeldItem.findUniqueOrThrow({ where: { id } })));
  }
}
