import {
  calcCluster,
  calcProjectTotal,
  clusterResultToDto,
  projectTotalToDto,
  type CalcSummaryDto,
  type ClusterCalcResult,
} from '@indotek/shared';
import type { Cluster, EffectiveSetting, ProjectBudget } from '../api/types';

export interface Assumption {
  interestRate: string;
  retensiAsCost: boolean;
}

/** Setting efektif project: override project tetap berlaku, selain itu pakai asumsi (preview/global). */
export function effectiveAssumption(setting: EffectiveSetting, preview: Assumption): Assumption {
  return {
    interestRate: setting.overridden.includes('interestRate') ? setting.interestRate : preview.interestRate,
    retensiAsCost: setting.overridden.includes('retensiAsCost') ? setting.retensiAsCost : preview.retensiAsCost,
  };
}

export function calcClusterLocal(c: Cluster, a: Assumption): ClusterCalcResult {
  return calcCluster({
    nilaiPoImpl: c.nilaiPoImpl,
    nilaiPoPermit: c.nilaiPoPermit,
    permitCost: c.permitCost,
    pajakRate: c.pajakRate,
    retensiRate: c.retensiRate,
    interestRate: a.interestRate,
    retensiAsCost: a.retensiAsCost,
    lines: c.lines.map((l) => ({ code: l.code, mode: l.mode, pct: l.pct, amount: l.amount })),
  });
}

export interface RecalcProject {
  project: ProjectBudget['project'];
  assumption: Assumption;
  clusters: (Cluster & { calc: CalcSummaryDto })[];
  total: CalcSummaryDto;
  results: ClusterCalcResult[];
}

/** Hitung ulang semua cluster di browser (preview what-if) memakai kalkulasi shared yang sama dengan API. */
export function recalcProjects(projects: ProjectBudget[], preview: Assumption) {
  const all: ClusterCalcResult[] = [];
  const out: RecalcProject[] = projects.map((p) => {
    const a = effectiveAssumption(p.setting, preview);
    const results = p.clusters.map((c) => calcClusterLocal(c, a));
    all.push(...results);
    return {
      project: p.project,
      assumption: a,
      clusters: p.clusters.map((c, i) => ({ ...c, calc: clusterResultToDto(results[i]) })),
      total: projectTotalToDto(calcProjectTotal(results)),
      results,
    };
  });
  return { projects: out, grandTotal: projectTotalToDto(calcProjectTotal(all)) };
}
