import type { FrCode, PrismaClient } from '@prisma/client';
import { BUDGET_LABEL, calcCluster, dec, frBudgetAmounts, FR_CODES, moneyStr, safeDiv, type D } from '@indotek/shared';
import type { Tx } from '../prisma/prisma.service';
import { clusterCalcInput } from '../budget/budget.mapper';

type Db = PrismaClient | Tx;

export interface OverrunItem {
  clusterId: string;
  clusterName: string;
  projectId: string;
  projectCode: string;
  /** Pos budget, atau TOTAL untuk seluruh cluster. */
  code: FrCode | 'TOTAL';
  label: string;
  budget: string;
  realisasi: string;
  pctTerpakai: string;
  threshold: string;
}

async function effectiveSettings(db: Db) {
  const rows = await db.setting.findMany();
  const global = rows.find((r) => r.projectId === null);
  return (projectId: string) => {
    const own = rows.find((r) => r.projectId === projectId);
    return {
      interestRate: (own?.interestRate ?? global?.interestRate ?? '0.10').toString(),
      retensiAsCost: own?.retensiAsCost ?? global?.retensiAsCost ?? false,
      overPct: (own?.realisasiOverPct ?? global?.realisasiOverPct ?? '1').toString(),
    };
  };
}

const isOver = (budget: D, real: D, threshold: D) => (budget.isZero() ? real.gt(0) : real.div(budget).gt(threshold));

/**
 * Pos/cluster yang realisasi terverifikasinya melewati ambang (Setting.realisasiOverPct, default 100%).
 * Budget pos 0 dengan realisasi > 0 juga dihitung over.
 */
export async function computeOverruns(db: Db, clusterIds?: string[]): Promise<OverrunItem[]> {
  const clusters = await db.cluster.findMany({
    where: { ...(clusterIds ? { id: { in: clusterIds } } : {}), status: { not: 'CANCELLED' } },
    include: { budgetLines: true, project: { select: { code: true } } },
    orderBy: [{ projectId: 'asc' }, { sortOrder: 'asc' }],
  });
  if (!clusters.length) return [];
  const settingOf = await effectiveSettings(db);
  const allocs = await db.expenseAllocation.findMany({
    where: { clusterId: { in: clusters.map((c) => c.id) }, expense: { status: 'TERVERIFIKASI' } },
    select: { clusterId: true, amount: true, expense: { select: { budgetCode: true } } },
  });
  const out: OverrunItem[] = [];
  for (const c of clusters) {
    const st = settingOf(c.projectId);
    const threshold = dec(st.overPct);
    const budget = frBudgetAmounts(calcCluster(clusterCalcInput(c, st)));
    const real: Partial<Record<FrCode, D>> = {};
    for (const a of allocs.filter((x) => x.clusterId === c.id)) {
      real[a.expense.budgetCode] = (real[a.expense.budgetCode] ?? dec(0)).plus(a.amount.toString());
    }
    const push = (code: FrCode | 'TOTAL', b: D, r: D) =>
      out.push({
        clusterId: c.id,
        clusterName: c.name,
        projectId: c.projectId,
        projectCode: c.project.code,
        code,
        label: code === 'TOTAL' ? 'Total cluster' : BUDGET_LABEL[code],
        budget: moneyStr(b),
        realisasi: moneyStr(r),
        pctTerpakai: safeDiv(r, b).toDecimalPlaces(8).toFixed(8),
        threshold: threshold.toString(),
      });
    let tb = dec(0);
    let tr = dec(0);
    for (const code of FR_CODES) {
      const b = budget[code].toDecimalPlaces(2);
      const r = real[code] ?? dec(0);
      tb = tb.plus(b);
      tr = tr.plus(r);
      if (isOver(b, r, threshold)) push(code, b, r);
    }
    if (isOver(tb, tr, threshold)) push('TOTAL', tb, tr);
  }
  return out;
}

export const overrunKey = (clusterId: string, code: string) => `OVER:${clusterId}:${code}`;

/**
 * Kirim notifikasi in-app ke PM & DIREKTUR (aktif) untuk pos/cluster yang baru melewati ambang.
 * Kunci OVER:{clusterId}:{pos} mencegah notifikasi ganda; bila pos kembali di bawah ambang, notifikasinya
 * dihapus sehingga akan dikirim lagi bila melewati ambang lagi.
 */
export async function scanOverruns(db: Db, clusterIds?: string[]) {
  const items = await computeOverruns(db, clusterIds);
  const scoped = clusterIds ?? (await db.cluster.findMany({ select: { id: true } })).map((c) => c.id);
  const activeKeys = new Set(items.map((i) => overrunKey(i.clusterId, i.code)));
  // re-arm: hapus notifikasi pos yang sudah tidak over
  const stale = await db.notification.findMany({
    where: { type: 'OVER_BUDGET', OR: scoped.map((id) => ({ key: { startsWith: `OVER:${id}:` } })) },
    select: { id: true, key: true },
  });
  const staleIds = stale.filter((n) => !activeKeys.has(n.key)).map((n) => n.id);
  if (staleIds.length) await db.notification.deleteMany({ where: { id: { in: staleIds } } });
  if (!items.length) return { over: 0, created: 0 };
  const users = await db.user.findMany({ where: { role: { in: ['PM', 'DIREKTUR'] }, active: true }, select: { id: true } });
  const data = users.flatMap((u) =>
    items.map((i) => ({
      userId: u.id,
      type: 'OVER_BUDGET',
      key: overrunKey(i.clusterId, i.code),
      title: `Over budget: ${i.clusterName}`,
      body: `${i.label} terpakai ${dec(i.pctTerpakai).times(100).toDecimalPlaces(1).toString().replace('.', ',')}% (realisasi ${i.realisasi} / budget ${i.budget}) — ${i.projectCode}`,
      link: `/clusters/${i.clusterId}?tab=realisasi`,
    })),
  );
  const res = await db.notification.createMany({ data, skipDuplicates: true });
  return { over: items.length, created: res.count };
}
