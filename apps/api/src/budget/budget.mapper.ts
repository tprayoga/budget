import type { BudgetLine, Cluster } from '@prisma/client';
import { BUDGET_LINE_CODES, type ClusterCalcInput } from '@indotek/shared';
import { s } from '../common/decimal';

export type ClusterWithLines = Cluster & { budgetLines: BudgetLine[] };

export function clusterCalcInput(
  c: ClusterWithLines,
  setting: { interestRate: string; retensiAsCost: boolean },
): ClusterCalcInput {
  return {
    nilaiPoImpl: c.nilaiPoImpl.toString(),
    nilaiPoPermit: c.nilaiPoPermit.toString(),
    permitPoAmount: c.permitPoAmount.toString(),
    permitCost: c.permitCost.toString(),
    pajakRate: c.pajakRate.toString(),
    retensiRate: c.retensiRate.toString(),
    interestRate: setting.interestRate,
    retensiAsCost: setting.retensiAsCost,
    lines: c.budgetLines.map((l) => ({
      code: l.code,
      mode: l.mode,
      pct: l.pct?.toString() ?? null,
      amount: l.amount?.toString() ?? null,
    })),
  };
}

export function clusterDto(c: ClusterWithLines) {
  const order = new Map(BUDGET_LINE_CODES.map((code, i) => [code, i]));
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    info: c.info,
    division: c.division,
    status: c.status,
    sortOrder: c.sortOrder,
    nilaiPoImpl: s(c.nilaiPoImpl)!,
    nilaiPoPermit: s(c.nilaiPoPermit)!,
    permitCost: s(c.permitCost)!,
    permitPoAmount: s(c.permitPoAmount)!,
    note: c.note,
    pajakRate: s(c.pajakRate)!,
    retensiRate: s(c.retensiRate)!,
    implementationDate: c.implementationDate ? c.implementationDate.toISOString().slice(0, 10) : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    lines: [...c.budgetLines]
      .sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0))
      .map((l) => ({ code: l.code, label: l.label, mode: l.mode, pct: s(l.pct), amount: s(l.amount) })),
  };
}
