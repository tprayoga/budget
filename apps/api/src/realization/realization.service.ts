import { Injectable } from '@nestjs/common';
import type { ExpenseStatus, FrCode } from '@prisma/client';
import {
  calcCluster,
  calcFundUsage,
  calcRealization,
  calcRealizedProfit,
  dec,
  EXPENSE_CATEGORIES,
  frBudgetAmounts,
  moneyStr,
  sum,
  type D,
} from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/auth.types';
import { clusterCalcInput } from '../budget/budget.mapper';
import { s } from '../common/decimal';

const m = (v: D) => moneyStr(v);
const r8 = (v: D) => v.toDecimalPlaces(8).toFixed(8);

type ByCode = Partial<Record<FrCode, D>>;

/**
 * Realisasi biaya vs budget. Hanya expense TERVERIFIKASI yang dihitung (PERLU_VERIFIKASI ditampilkan terpisah);
 * angka per cluster selalu dari ExpenseAllocation.
 */
@Injectable()
export class RealizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
  ) {}

  /** Σ alokasi per cluster per pos budget (dan per kategori), menurut status. */
  async allocationSums(clusterIds: string[], status: ExpenseStatus) {
    const rows = await this.prisma.expenseAllocation.findMany({
      where: { clusterId: { in: clusterIds }, expense: { status } },
      select: { clusterId: true, amount: true, expense: { select: { budgetCode: true, category: true } } },
    });
    const byCluster = new Map<string, { byCode: ByCode; byCategory: Record<string, D>; total: D }>();
    for (const id of clusterIds) byCluster.set(id, { byCode: {}, byCategory: {}, total: dec(0) });
    for (const r of rows) {
      const b = byCluster.get(r.clusterId)!;
      const a = dec(r.amount.toString());
      b.byCode[r.expense.budgetCode] = (b.byCode[r.expense.budgetCode] ?? dec(0)).plus(a);
      b.byCategory[r.expense.category] = (b.byCategory[r.expense.category] ?? dec(0)).plus(a);
      b.total = b.total.plus(a);
    }
    return byCluster;
  }

  private async paymentsByCluster(clusterIds: string[]) {
    const rows = await this.prisma.clientPayment.findMany({ where: { clusterId: { in: clusterIds } } });
    const map = new Map<string, typeof rows>();
    for (const id of clusterIds) map.set(id, []);
    for (const p of rows) map.get(p.clusterId)!.push(p);
    return map;
  }

  /** Tab Realisasi cluster: per pos Budget vs Realisasi vs Sisa vs % terpakai + profit realisasi. */
  async cluster(user: AuthUser, clusterId: string) {
    await this.access.assertCluster(user, clusterId);
    const c = await this.prisma.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { budgetLines: true } });
    const setting = await this.settings.effective(c.projectId);
    const calc = calcCluster(clusterCalcInput(c, setting));
    const budget = frBudgetAmounts(calc);
    const [verified, pending, payments] = await Promise.all([
      this.allocationSums([clusterId], 'TERVERIFIKASI'),
      this.allocationSums([clusterId], 'PERLU_VERIFIKASI'),
      this.paymentsByCluster([clusterId]),
    ]);
    const v = verified.get(clusterId)!;
    const p = pending.get(clusterId)!;
    const real = calcRealization(budget, v.byCode, setting.realisasiWarnPct, p.byCode);
    const profit = calcRealizedProfit(
      payments.get(clusterId)!.map((x) => ({ status: x.status, amount: x.amount.toString(), paidAmount: x.paidAmount?.toString() ?? null })),
      v.total,
    );
    return {
      clusterId,
      warnPct: setting.realisasiWarnPct,
      rows: real.rows.map((x) => ({
        code: x.code,
        budget: m(x.budget),
        realisasi: m(x.realisasi),
        sisa: m(x.sisa),
        pctTerpakai: r8(x.pctTerpakai),
        level: x.level,
        menungguVerifikasi: m(x.menungguVerifikasi),
      })),
      total: {
        budget: m(real.total.budget),
        realisasi: m(real.total.realisasi),
        sisa: m(real.total.sisa),
        pctTerpakai: r8(real.total.pctTerpakai),
        level: real.total.level,
        menungguVerifikasi: m(real.total.menungguVerifikasi),
      },
      byCategory: EXPENSE_CATEGORIES.map((cat) => ({ category: cat, realisasi: m(v.byCategory[cat] ?? dec(0)) })),
      profit: {
        nilaiProyek: m(calc.nilaiProyek),
        proyeksiProfit: m(calc.profit),
        pembayaranBruto: m(profit.pembayaranBruto),
        kasDiterima: m(profit.kasDiterima),
        realisasiBiaya: m(profit.realisasiBiaya),
        profitRealisasi: m(profit.profitRealisasi),
      },
    };
  }

  /** Ringkasan realisasi per cluster (untuk Rekap & halaman project). */
  async summaryByCluster(clusterIds: string[]) {
    const [verified, pending, payments] = await Promise.all([
      this.allocationSums(clusterIds, 'TERVERIFIKASI'),
      this.allocationSums(clusterIds, 'PERLU_VERIFIKASI'),
      this.paymentsByCluster(clusterIds),
    ]);
    const out = new Map<string, { realisasiBiaya: string; menungguVerifikasi: string; pembayaranBruto: string; kasDiterima: string; profitRealisasi: string }>();
    for (const id of clusterIds) {
      const p = calcRealizedProfit(
        payments.get(id)!.map((x) => ({ status: x.status, amount: x.amount.toString(), paidAmount: x.paidAmount?.toString() ?? null })),
        verified.get(id)!.total,
      );
      out.set(id, {
        realisasiBiaya: m(p.realisasiBiaya),
        menungguVerifikasi: m(pending.get(id)!.total),
        pembayaranBruto: m(p.pembayaranBruto),
        kasDiterima: m(p.kasDiterima),
        profitRealisasi: m(p.profitRealisasi),
      });
    }
    return out;
  }

  async project(user: AuthUser, projectId: string) {
    await this.access.assertProject(user, projectId);
    const clusters = await this.prisma.cluster.findMany({ where: { projectId }, orderBy: [{ sortOrder: 'asc' }], select: { id: true, name: true } });
    const sums = await this.summaryByCluster(clusters.map((c) => c.id));
    const rows = clusters.map((c) => ({ clusterId: c.id, name: c.name, ...sums.get(c.id)! }));
    const tot = (k: keyof (typeof rows)[number]) => m(sum(rows.map((r) => r[k] as string)));
    return {
      clusters: rows,
      total: {
        realisasiBiaya: tot('realisasiBiaya'),
        menungguVerifikasi: tot('menungguVerifikasi'),
        pembayaranBruto: tot('pembayaranBruto'),
        kasDiterima: tot('kasDiterima'),
        profitRealisasi: tot('profitRealisasi'),
      },
    };
  }

  /**
   * Rekonsiliasi sederhana per bulan: Σ cash out buku kas project vs Σ expense terverifikasi project.
   * Tanpa pencocokan otomatis per transaksi.
   */
  async reconciliation(user: AuthUser, projectId: string) {
    await this.access.assertProject(user, projectId);
    const [ledger, expenses] = await Promise.all([
      this.prisma.cashLedger.findMany({ where: { projectId }, select: { date: true, cashOut: true, cashIn: true } }),
      this.prisma.expense.findMany({ where: { projectId, status: 'TERVERIFIKASI' }, select: { date: true, amount: true } }),
    ]);
    const months = new Map<string, { cashOut: D; cashIn: D; expense: D; ledgerRows: number; expenseRows: number }>();
    const bucket = (k: string) => {
      if (!months.has(k)) months.set(k, { cashOut: dec(0), cashIn: dec(0), expense: dec(0), ledgerRows: 0, expenseRows: 0 });
      return months.get(k)!;
    };
    for (const l of ledger) {
      const b = bucket(l.date.toISOString().slice(0, 7));
      b.cashOut = b.cashOut.plus(l.cashOut.toString());
      b.cashIn = b.cashIn.plus(l.cashIn.toString());
      b.ledgerRows++;
    }
    for (const e of expenses) {
      const b = bucket(e.date ? e.date.toISOString().slice(0, 7) : 'TANPA_TANGGAL');
      b.expense = b.expense.plus(e.amount.toString());
      b.expenseRows++;
    }
    const rows = [...months.entries()]
      .sort(([a], [b]) => (a === 'TANPA_TANGGAL' ? 1 : b === 'TANPA_TANGGAL' ? -1 : a.localeCompare(b)))
      .map(([month, v]) => ({
        month,
        cashOut: m(v.cashOut),
        cashIn: m(v.cashIn),
        expense: m(v.expense),
        selisih: m(v.cashOut.minus(v.expense)),
        ledgerRows: v.ledgerRows,
        expenseRows: v.expenseRows,
      }));
    return {
      rows,
      total: {
        cashOut: m(sum(rows.map((x) => x.cashOut))),
        cashIn: m(sum(rows.map((x) => x.cashIn))),
        expense: m(sum(rows.map((x) => x.expense))),
        selisih: m(sum(rows.map((x) => x.selisih))),
      },
    };
  }

  /** Dana cair vs realisasi (expense terverifikasi yang ditautkan, porsi cluster pengajuan) vs sisa di tangan. */
  async fundRequestUsage(frId: string) {
    const fr = await this.prisma.fundRequest.findUniqueOrThrow({ where: { id: frId }, include: { lines: true } });
    const allocs = await this.prisma.expenseAllocation.findMany({
      where: { clusterId: fr.clusterId, expense: { fundRequestId: frId, status: 'TERVERIFIKASI' } },
      select: { amount: true, expense: { select: { budgetCode: true } } },
    });
    const cair: ByCode = {};
    if (fr.status === 'DICAIRKAN') for (const l of fr.lines) cair[l.budgetCode] = dec(l.diajukan.toString());
    const realized: ByCode = {};
    for (const a of allocs) realized[a.expense.budgetCode] = (realized[a.expense.budgetCode] ?? dec(0)).plus(a.amount.toString());
    const u = calcFundUsage(cair, realized);
    const pending = await this.prisma.expense.count({ where: { fundRequestId: frId, status: 'PERLU_VERIFIKASI' } });
    return {
      dicairkan: fr.status === 'DICAIRKAN',
      rows: u.rows.map((x) => ({ code: x.code, cair: m(x.cair), realisasi: m(x.realisasi), sisa: m(x.sisa) })),
      total: { cair: m(u.total.cair), realisasi: m(u.total.realisasi), sisa: m(u.total.sisa) },
      menungguVerifikasi: pending,
      cairTanggal: fr.cairTanggal ? fr.cairTanggal.toISOString().slice(0, 10) : null,
      totalDiajukan: s(fr.totalDiajukan),
    };
  }
}
