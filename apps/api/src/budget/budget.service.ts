import { Injectable } from '@nestjs/common';
import {
  calcCluster,
  calcProjectTotal,
  clusterResultToDto,
  projectTotalToDto,
  type ClusterCalcResult,
} from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { SettingsService, type EffectiveSetting } from '../settings/settings.service';
import type { AuthUser } from '../auth/auth.types';
import { clusterCalcInput, clusterDto, type ClusterWithLines } from './budget.mapper';
import { RealizationService } from '../realization/realization.service';
import { computeOverruns } from '../notifications/overrun';

/** Preview what-if: menimpa setting global tanpa menyimpan. */
export interface BudgetPreview {
  interestRate?: string;
  retensiAsCost?: boolean;
}

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly realization: RealizationService,
  ) {}

  /** Setting efektif project dengan preview (preview menggantikan nilai global; override project tetap berlaku). */
  async settingFor(projectId: string | null, preview?: BudgetPreview): Promise<EffectiveSetting> {
    const eff = await this.settings.effective(projectId);
    return {
      ...eff,
      interestRate:
        preview?.interestRate !== undefined && !eff.overridden.includes('interestRate')
          ? preview.interestRate
          : eff.interestRate,
      retensiAsCost:
        preview?.retensiAsCost !== undefined && !eff.overridden.includes('retensiAsCost')
          ? preview.retensiAsCost
          : eff.retensiAsCost,
    };
  }

  calc(cluster: ClusterWithLines, setting: { interestRate: string; retensiAsCost: boolean }): ClusterCalcResult {
    return calcCluster(clusterCalcInput(cluster, setting));
  }

  async projectBudget(user: AuthUser, projectId: string, preview?: BudgetPreview) {
    const project = await this.access.assertProject(user, projectId);
    const [full, setting] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({
        where: { id: project.id },
        include: {
          client: true,
          clusters: { include: { budgetLines: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        },
      }),
      this.settingFor(projectId, preview),
    ]);
    const results = full.clusters.map((c) => this.calc(c, setting));
    return {
      project: { id: full.id, code: full.code, name: full.name, year: full.year, client: full.client },
      setting,
      clusters: full.clusters.map((c, i) => ({ ...clusterDto(c), calc: clusterResultToDto(results[i]) })),
      total: projectTotalToDto(calcProjectTotal(results)),
    };
  }

  /** Rekap semua project yang boleh dilihat user. */
  async rekap(user: AuthUser, preview?: BudgetPreview) {
    const projects = await this.prisma.project.findMany({
      where: this.access.projectWhere(user),
      include: {
        client: true,
        clusters: { include: { budgetLines: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: { code: 'asc' },
    });
    const allResults: ClusterCalcResult[] = [];
    const out = [];
    const realisasi = await this.realization.summaryByCluster(projects.flatMap((p) => p.clusters.map((c) => c.id)));
    for (const p of projects) {
      const setting = await this.settingFor(p.id, preview);
      const results = p.clusters.map((c) => this.calc(c, setting));
      allResults.push(...results);
      out.push({
        project: { id: p.id, code: p.code, name: p.name, year: p.year, client: p.client },
        setting,
        clusters: p.clusters.map((c, i) => ({ ...clusterDto(c), calc: clusterResultToDto(results[i]), realisasi: realisasi.get(c.id)! })),
        total: projectTotalToDto(calcProjectTotal(results)),
      });
    }
    return {
      global: await this.settingFor(null, preview),
      projects: out,
      grandTotal: projectTotalToDto(calcProjectTotal(allResults)),
      // pos/cluster yang realisasinya melewati ambang Setting.realisasiOverPct
      overBudget: await computeOverruns(this.prisma, projects.flatMap((p) => p.clusters.map((c) => c.id))),
    };
  }
}
