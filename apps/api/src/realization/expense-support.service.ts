import { BadRequestException, Injectable } from '@nestjs/common';
import type { AllocationMethod, ExpenseCategory, FrCode } from '@prisma/client';
import { allocateGroup, type AllocationTarget } from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { money, rate } from '../common/decimal';

export interface AllocationRequest {
  projectId: string;
  /** Expense level cluster */
  clusterId?: string | null;
  /** Expense level project: daftar cluster tujuan (kosong = semua cluster aktif project) */
  clusterIds?: string[];
  method?: AllocationMethod | null;
  manualAllocations?: { clusterId: string; amount: string }[];
  /** MANUAL berbasis persentase (grup import RAB) */
  manualPcts?: { clusterId: string; pct: string }[] | null;
}

/**
 * Pendukung expense: mapping kategori → pos budget dan perhitungan alokasi ke cluster.
 */
@Injectable()
export class ExpenseSupportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mapping efektif: mapping project meng-override global. */
  async categoryMap(projectId: string | null, db: Tx | PrismaService = this.prisma): Promise<Record<string, FrCode | null>> {
    const rows = await db.categoryMapping.findMany({ where: { OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] } });
    const map: Record<string, FrCode | null> = {};
    for (const r of rows.filter((x) => x.projectId === null)) map[r.category] = r.budgetCode;
    for (const r of rows.filter((x) => x.projectId !== null)) map[r.category] = r.budgetCode;
    return map;
  }

  /** Pos budget untuk kategori; `override` dipakai bila diisi pengguna. */
  async resolveBudgetCode(projectId: string, category: ExpenseCategory, override?: FrCode | null, db?: Tx | PrismaService) {
    if (override) return override;
    const map = await this.categoryMap(projectId, db);
    const code = map[category];
    if (!code) throw new BadRequestException(`Kategori ${category} belum punya pos budget default — pilih pos budget`);
    return code;
  }

  /** Cluster tujuan alokasi (urut sortOrder; cluster terakhir menerima sisa pembulatan). */
  async targets(req: AllocationRequest, db: Tx | PrismaService = this.prisma) {
    if (req.clusterId) {
      const c = await db.cluster.findUnique({ where: { id: req.clusterId } });
      if (!c || c.projectId !== req.projectId) throw new BadRequestException('Cluster tidak termasuk project');
      return [c];
    }
    const clusters = await db.cluster.findMany({
      where: {
        projectId: req.projectId,
        ...(req.clusterIds?.length ? { id: { in: req.clusterIds } } : { status: { not: 'CANCELLED' } }),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (req.clusterIds?.length && clusters.length !== new Set(req.clusterIds).size) {
      throw new BadRequestException('Ada cluster yang tidak termasuk project');
    }
    if (!clusters.length) throw new BadRequestException('Project belum punya cluster untuk dialokasikan');
    return clusters;
  }

  /** Hitung alokasi untuk sekelompok nominal (grup import dialokasikan kumulatif agar total per cluster cocok). */
  async computeGroup(amounts: string[], req: AllocationRequest, db: Tx | PrismaService = this.prisma) {
    const clusters = await this.targets(req, db);
    const method: AllocationMethod = req.clusterId ? 'EQUAL' : (req.method ?? 'EQUAL');
    const targets: AllocationTarget[] = clusters.map((c) => ({
      clusterId: c.id,
      nilaiPoImpl: c.nilaiPoImpl.toString(),
      manualAmount: req.manualAllocations?.find((m) => m.clusterId === c.id)?.amount ?? '0',
      ...(method === 'MANUAL' && req.manualPcts?.length ? { manualPct: req.manualPcts.find((m) => m.clusterId === c.id)?.pct ?? '0' } : {}),
    }));
    try {
      return { method, lines: allocateGroup(amounts, targets, method) };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Ganti alokasi expense. */
  async writeAllocations(tx: Tx, expenseId: string, lines: { clusterId: string; amount: { toString(): string }; pct: { toString(): string } }[]) {
    await tx.expenseAllocation.deleteMany({ where: { expenseId } });
    await tx.expenseAllocation.createMany({
      data: lines.map((l) => ({ expenseId, clusterId: l.clusterId, amount: money(l.amount.toString()), pct: rate(l.pct.toString()) })),
    });
  }
}
