import type { FrCode, PrismaClient } from '@prisma/client';
import { BUDGET_LABEL, calcCluster, dec, formatAngka, formatTanggal, frBudgetAmounts, FR_CODES, moneyStr, safeDiv, todayJakartaIso, type D } from '@indotek/shared';
import type { Tx } from '../prisma/prisma.service';
import { withLock } from '../redis/redis';
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

/** Pos: realisasi > ambang. Total cluster: realisasi ≥ ambang (Fase 2.4). Budget 0 dengan realisasi > 0 = over. */
const isOver = (budget: D, real: D, threshold: D, inclusive = false) =>
  budget.isZero() ? real.gt(0) : inclusive ? real.div(budget).gte(threshold) : real.div(budget).gt(threshold);

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
    if (isOver(tb, tr, threshold, true)) push('TOTAL', tb, tr);
  }
  return out;
}

export const overrunKey = (clusterId: string, code: string) => `OVER:${clusterId}:${code}`;

const pctText = (v: string) => `${dec(v).times(100).toDecimalPlaces(1).toString().replace('.', ',')}%`;

/**
 * Pemindaian over budget (Fase 2.4), status lintasan disimpan di OverrunState:
 *  - TOTAL cluster ≥ ambang → notifikasi langsung ke PM & DIREKTUR, sekali per lintasan ambang
 *    (tidak berulang selama masih di atas ambang; dikirim lagi hanya bila turun lalu melewati ambang lagi).
 *  - Pos yang > ambang → masuk "Ringkasan harian": 1 notifikasi per user per hari (Asia/Jakarta) berisi daftar
 *    pos yang baru melewati ambang hari itu; pos baru berikutnya di hari yang sama ditambahkan ke ringkasan yang sama.
 */
export async function scanOverruns(db: Db, clusterIds?: string[]) {
  // satu pemindaian dalam satu waktu lintas replika API (lock Redis) agar notifikasi lintasan tidak ganda
  return withLock('lock:overrun-scan', 60_000, () => scanOverrunsUnlocked(db, clusterIds));
}

async function scanOverrunsUnlocked(db: Db, clusterIds?: string[]) {
  const items = await computeOverruns(db, clusterIds);
  const scoped = clusterIds ?? (await db.cluster.findMany({ select: { id: true } })).map((c) => c.id);
  const states = await db.overrunState.findMany({ where: { clusterId: { in: scoped } } });
  const byKey = new Map(states.map((x) => [x.key, x]));
  const activeKeys = new Set(items.map((i) => overrunKey(i.clusterId, i.code)));
  // turun di bawah ambang → re-arm (riwayat notifikasi tidak dihapus)
  const rearm = states.filter((x) => x.over && !activeKeys.has(x.key)).map((x) => x.key);
  if (rearm.length) await db.overrunState.updateMany({ where: { key: { in: rearm } }, data: { over: false } });

  const crossed = items.filter((i) => !byKey.get(overrunKey(i.clusterId, i.code))?.over);
  if (!crossed.length) return { over: items.length, crossedTotal: 0, crossedPos: 0, notifications: 0 };
  const users = await db.user.findMany({ where: { role: { in: ['PM', 'DIREKTUR'] }, active: true }, select: { id: true } });
  // Belum ada penerima (mis. production baru dimigrasi, akun PM/Direktur belum dibuat): status lintasan TIDAK dicatat,
  // agar pemindaian pertama setelah penerima ada tetap mengirim ringkasan kondisi terkini.
  if (!users.length) return { over: items.length, crossedTotal: 0, crossedPos: 0, notifications: 0, noRecipients: true };
  const now = new Date();
  for (const i of crossed) {
    const key = overrunKey(i.clusterId, i.code);
    await db.overrunState.upsert({ where: { key }, create: { key, clusterId: i.clusterId, code: i.code, over: true, since: now }, update: { over: true, since: now } });
  }
  let notifications = 0;

  const totals = crossed.filter((i) => i.code === 'TOTAL');
  if (totals.length) {
    const res = await db.notification.createMany({
      data: users.flatMap((u) =>
        totals.map((i) => ({
          userId: u.id,
          type: 'OVER_BUDGET',
          key: `${overrunKey(i.clusterId, 'TOTAL')}:${now.toISOString()}`,
          title: `Over budget: ${i.clusterName}`,
          body: `Total realisasi ${pctText(i.pctTerpakai)} dari budget (Rp ${formatAngka(i.realisasi)} / Rp ${formatAngka(i.budget)}) — ${i.projectCode}`,
          link: `/clusters/${i.clusterId}?tab=realisasi`,
        })),
      ),
      skipDuplicates: true,
    });
    notifications += res.count;
  }

  const posItems = crossed.filter((i) => i.code !== 'TOTAL');
  if (posItems.length) {
    const today = todayJakartaIso();
    const lines = posItems.map((i) => `• ${i.projectCode} ${i.clusterName} — ${i.label}: ${Number(i.budget) ? pctText(i.pctTerpakai) : 'budget 0'} (Rp ${formatAngka(i.realisasi)} / Rp ${formatAngka(i.budget)})`);
    for (const u of users) {
      const key = `DIGEST:${today}`;
      const prev = await db.notification.findUnique({ where: { userId_key: { userId: u.id, key } } });
      if (prev) {
        await db.notification.update({ where: { id: prev.id }, data: { body: `${prev.body}\n${lines.join('\n')}`, readAt: null, title: digestTitle(today, prev.body.split('\n').length + lines.length) } });
      } else {
        await db.notification.create({
          data: { userId: u.id, type: 'OVER_BUDGET_DIGEST', key, title: digestTitle(today, lines.length), body: lines.join('\n'), link: '/rekap' },
        });
        notifications++;
      }
    }
  }
  return { over: items.length, crossedTotal: totals.length, crossedPos: posItems.length, notifications };
}

function digestTitle(day: string, n: number) {
  return `Ringkasan harian over budget ${formatTanggal(day)} — ${n} pos`;
}
