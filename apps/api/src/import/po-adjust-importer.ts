import type { Cluster, PrismaClient } from '@prisma/client';
import { dec, sum } from '@indotek/shared';
import { clusterNameKey, type ParsedRab, type RabPoAdjustment } from '@indotek/shared/xlsx';
import type { AuditService } from '../audit/audit.service';
import { money } from '../common/decimal';
import { ensureClusterPos, poFlat, syncDerivedFromPos } from '../clusters/po-support';
import { generateClientPayments } from '../realization/termin-generator';
import { scanOverruns } from '../notifications/overrun';

export type PoAdjStatus = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'NO_CLUSTER';

const refOf = (key: string) => `RAB:${key}`;

export interface PoAdjPreviewItem extends RabPoAdjustment {
  projectId: string;
  projectCode: string;
  clusterId: string | null;
  clusterName: string | null;
  status: PoAdjStatus;
  oldAmount: string | null;
}

/**
 * Import penyesuaian PO dari file RAB (baris "Deduction Termin 1 + Addwork" sheet ADW) sebagai ClusterPo
 * ADDWORK (+) / DEDUCTION (−). Idempotent lewat sourceRef `RAB:{sheet}!{cell}[#n]`. Dry-run menampilkan
 * nilai PO implementasi cluster sebelum → sesudah.
 */
export class PoAdjustImporter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async preview(parsed: ParsedRab, allowedProjectIds?: string[]) {
    const items: PoAdjPreviewItem[] = [];
    for (const sh of parsed.projects) {
      if (!sh.poAdjustments.length) continue;
      const project = await this.prisma.project.findUnique({ where: { code: sh.projectCode } });
      if (!project || (allowedProjectIds && !allowedProjectIds.includes(project.id))) continue;
      const clusters = await this.prisma.cluster.findMany({ where: { projectId: project.id } });
      const byKey = new Map<string, Cluster[]>();
      for (const c of clusters) byKey.set(clusterNameKey(c.name), [...(byKey.get(clusterNameKey(c.name)) ?? []), c]);
      for (const a of sh.poAdjustments) {
        const hit = a.blockTitle ? byKey.get(clusterNameKey(a.blockTitle)) : undefined;
        const cluster = hit?.length === 1 ? hit[0] : null;
        const existing = await this.prisma.clusterPo.findUnique({ where: { sourceRef: refOf(a.key) } });
        const status: PoAdjStatus = !cluster
          ? 'NO_CLUSTER'
          : !existing
            ? 'NEW'
            : existing.kind === a.kind && existing.amount.eq(a.amount) && existing.clusterId === cluster.id
              ? 'UNCHANGED'
              : 'CHANGED';
        items.push({
          ...a,
          projectId: project.id,
          projectCode: project.code,
          clusterId: cluster?.id ?? null,
          clusterName: cluster?.name ?? null,
          status,
          oldAmount: existing ? existing.amount.toFixed(2) : null,
        });
      }
    }
    // nilai PO implementasi per cluster: sekarang → setelah import
    const clusterIds = [...new Set(items.map((i) => i.clusterId).filter((x): x is string => !!x))];
    const clusters = await this.prisma.cluster.findMany({ where: { id: { in: clusterIds } } });
    const summary = clusters.map((c) => {
      const mine = items.filter((i) => i.clusterId === c.id && i.status !== 'UNCHANGED');
      const delta = sum(mine.map((i) => dec(i.amount).minus(i.oldAmount ?? 0)));
      return { clusterId: c.id, clusterName: c.name, nilaiPoImplNow: c.nilaiPoImpl.toFixed(2), nilaiPoImplAfter: delta.plus(c.nilaiPoImpl.toString()).toFixed(2) };
    });
    const count = (s: PoAdjStatus) => items.filter((i) => i.status === s).length;
    return { items, clusters: summary, summary: { NEW: count('NEW'), CHANGED: count('CHANGED'), UNCHANGED: count('UNCHANGED'), NO_CLUSTER: count('NO_CLUSTER') } };
  }

  async commit(parsed: ParsedRab, userId: string | null, allowedProjectIds?: string[]) {
    const p = await this.preview(parsed, allowedProjectIds);
    const todo = p.items.filter((i) => i.status === 'NEW' || i.status === 'CHANGED');
    const touched = new Set<string>();
    await this.prisma.$transaction(
      async (tx) => {
        for (const it of todo) {
          const clusterId = it.clusterId!;
          await ensureClusterPos(tx, clusterId);
          const sourceRef = refOf(it.key);
          const before = await tx.clusterPo.findUnique({ where: { sourceRef } });
          const data = {
            clusterId,
            kind: it.kind,
            amount: money(it.amount),
            note: `Deduction Termin 1 + Addwork (RAB ${it.key}, ${it.source}; total ${it.totalFormula ?? '-'})`,
          };
          const po = before ? await tx.clusterPo.update({ where: { id: before.id }, data }) : await tx.clusterPo.create({ data: { ...data, sourceRef } });
          await this.audit.diff(tx, userId, 'ClusterPo', po.id, poFlat(before), { ...poFlat(po)!, sumber: `import-rab:${it.key}` });
          touched.add(clusterId);
        }
        for (const id of touched) {
          const d = await syncDerivedFromPos(tx, id);
          await this.audit.diff(tx, userId, 'Cluster', id, d.before, { ...d.after, sumber: 'import penyesuaian PO' });
          await generateClientPayments(tx, id);
        }
      },
      { timeout: 60_000 },
    );
    if (touched.size) await scanOverruns(this.prisma, [...touched]);
    return { created: todo.filter((i) => i.status === 'NEW').length, updated: todo.filter((i) => i.status === 'CHANGED').length, preview: await this.preview(parsed, allowedProjectIds) };
  }
}
