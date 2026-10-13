import type { AllocationMethod, Cluster, ExpenseCategory, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { dec, type RabDecision } from '@indotek/shared';
import { clusterNameKey, parseRabWorkbook, type ParsedRab, type RabExpenseItem } from '@indotek/shared/xlsx';
import type { AuditService } from '../audit/audit.service';
import type { ExpenseSupportService } from '../realization/expense-support.service';
import { flatExpense } from '../realization/expenses.service';
import { money } from '../common/decimal';

export type RabTarget =
  | { scope: 'CLUSTER'; clusterId: string; clusterName: string }
  | { scope: 'PROJECT'; clusterIds: string[]; clusterNames: string[]; method: AllocationMethod }
  | { scope: 'SKIP' };

export type RabItemStatus = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'NEEDS_MAPPING' | 'SKIPPED';

export interface RabPreviewItem extends RabExpenseItem {
  projectCode: string;
  projectId: string | null;
  /** Kunci keputusan grup/blok (target cluster). */
  mappingKey: string;
  target: RabTarget | null;
  targetSource: 'AUTO' | 'RULE' | null;
  suggestedTarget: RabTarget | null;
  status: RabItemStatus;
  diffs: { field: string; oldValue: string | null; newValue: string | null }[];
}

export const sourceRefOf = (item: { key: string }) => `RAB:${item.key}`;

export function mappingKeyOf(item: RabExpenseItem): string {
  if (item.section === 'SUBCON') return `RAB:${item.sheet}:BLOCK:${item.blockTitle ?? '?'}`;
  return `RAB:${item.sheet}:${item.section}:${item.groupTitle ?? item.blockTitle ?? ''}`;
}

const descOf = (i: RabExpenseItem) => {
  const ctx = i.blockTitle ?? i.groupTitle;
  return ctx ? `${i.label} — ${ctx}` : i.label;
};

/**
 * Import realisasi dari file RAB. Item yang cluster/kategorinya tidak bisa ditentukan otomatis
 * berstatus NEEDS_MAPPING sampai pengguna memberi keputusan (disimpan sebagai ImportMappingRule).
 * Expense hasil import langsung TERVERIFIKASI (sumber: buku Finance), idempotent lewat sourceRef.
 */
export class RabImporter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly support: ExpenseSupportService,
  ) {}

  async parse(buffer: Buffer): Promise<ParsedRab> {
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
    return parseRabWorkbook(wb);
  }

  private async rules(keys: string[]) {
    const rows = await this.prisma.importMappingRule.findMany({ where: { sourceKey: { in: keys } } });
    return new Map(rows.map((r) => [r.sourceKey, r]));
  }

  private targetFrom(
    rule: { scope: string; clusterId: string | null; clusterIds: string[]; method: AllocationMethod | null },
    clusters: Cluster[],
  ): RabTarget | null {
    if (rule.scope === 'SKIP') return { scope: 'SKIP' };
    if (rule.scope === 'CLUSTER' && rule.clusterId) {
      const c = clusters.find((x) => x.id === rule.clusterId);
      return c ? { scope: 'CLUSTER', clusterId: c.id, clusterName: c.name } : null;
    }
    if (rule.scope === 'PROJECT') {
      const list = rule.clusterIds.length ? clusters.filter((c) => rule.clusterIds.includes(c.id)) : clusters.filter((c) => c.status !== 'CANCELLED');
      if (!list.length) return null;
      return { scope: 'PROJECT', clusterIds: list.map((c) => c.id), clusterNames: list.map((c) => c.name), method: rule.method ?? 'EQUAL' };
    }
    return null;
  }

  async preview(parsed: ParsedRab, allowedProjectIds?: string[]) {
    const sheets = [];
    const items: RabPreviewItem[] = [];
    for (const p of parsed.projects) {
      const project = await this.prisma.project.findUnique({ where: { code: p.projectCode } });
      const denied = project && allowedProjectIds && !allowedProjectIds.includes(project.id);
      sheets.push({
        sheetName: p.sheetName,
        projectCode: p.projectCode,
        projectId: denied ? null : (project?.id ?? null),
        error: !project ? `Project ${p.projectCode} belum ada` : denied ? 'Tidak punya akses ke project ini' : null,
        totals: p.totals,
        invoices: p.invoices,
      });
      if (!project || denied) continue;
      const clusters = await this.prisma.cluster.findMany({ where: { projectId: project.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
      const byKey = new Map<string, Cluster[]>();
      for (const c of clusters) byKey.set(clusterNameKey(c.name), [...(byKey.get(clusterNameKey(c.name)) ?? []), c]);
      const keys = [...new Set(p.items.flatMap((i) => [mappingKeyOf(i), sourceRefOf(i)]))];
      const rules = await this.rules(keys);
      const existing = new Map(
        (await this.prisma.expense.findMany({ where: { sourceRef: { in: p.items.map(sourceRefOf) } }, include: { allocations: true } })).map((e) => [e.sourceRef!, e]),
      );
      const active = clusters.filter((c) => c.status !== 'CANCELLED');

      for (const it of p.items) {
        const mk = mappingKeyOf(it);
        const itemRule = rules.get(sourceRefOf(it));
        const groupRule = rules.get(mk);
        let target: RabTarget | null = null;
        let targetSource: RabPreviewItem['targetSource'] = null;
        if (itemRule && itemRule.scope) target = this.targetFrom(itemRule, clusters);
        if (!target && groupRule) target = this.targetFrom(groupRule, clusters);
        if (target) targetSource = 'RULE';
        if (!target && it.section === 'SUBCON' && it.blockTitle) {
          const match = byKey.get(clusterNameKey(it.blockTitle));
          if (match?.length === 1) {
            target = { scope: 'CLUSTER', clusterId: match[0].id, clusterName: match[0].name };
            targetSource = 'AUTO';
          }
        }
        // usulan (tidak diterapkan otomatis): rata ke cluster yang namanya memuat kata blok, atau semua cluster project
        let suggestedTarget: RabTarget | null = null;
        if (!target) {
          const words = clusterNameKey(it.groupTitle ?? it.blockTitle ?? '').split(' ').filter((w) => w.length > 3 && !['cluster', 'site', 'ccsi'].includes(w));
          const hits = active.filter((c) => words.some((w) => c.name.toLowerCase().includes(w)));
          const list = hits.length ? hits : active;
          if (list.length) suggestedTarget = { scope: 'PROJECT', clusterIds: list.map((c) => c.id), clusterNames: list.map((c) => c.name), method: 'EQUAL' };
        }
        const category = (itemRule?.category ?? groupRule?.category ?? it.category) as ExpenseCategory | null;
        const prev = existing.get(sourceRefOf(it));
        let status: RabItemStatus;
        const diffs: RabPreviewItem['diffs'] = [];
        if (target?.scope === 'SKIP') status = 'SKIPPED';
        else if (!target || !category) status = 'NEEDS_MAPPING';
        else if (!prev) status = 'NEW';
        else {
          const tIds = target.scope === 'CLUSTER' ? [target.clusterId] : target.clusterIds;
          const cmp: [string, string | null, string | null][] = [
            ['amount', dec(prev.amount.toString()).toString(), dec(it.amount).toString()],
            ['category', prev.category, category],
            ['date', prev.date ? prev.date.toISOString().slice(0, 10) : null, it.date],
            ['description', prev.description, descOf(it)],
            ['clusters', prev.allocations.map((a) => a.clusterId).sort().join(','), [...tIds].sort().join(',')],
            ['method', prev.allocationMethod, target.scope === 'PROJECT' ? target.method : null],
          ];
          for (const [field, o, n] of cmp) if (o !== n) diffs.push({ field, oldValue: o, newValue: n });
          status = diffs.length ? 'CHANGED' : 'UNCHANGED';
        }
        items.push({
          ...it,
          category,
          needsMapping: status === 'NEEDS_MAPPING',
          projectCode: p.projectCode,
          projectId: project.id,
          mappingKey: mk,
          target,
          targetSource,
          suggestedTarget,
          status,
          diffs,
        });
      }
    }
    const summary: Record<RabItemStatus, number> = { NEW: 0, CHANGED: 0, UNCHANGED: 0, NEEDS_MAPPING: 0, SKIPPED: 0 };
    for (const i of items) summary[i.status]++;
    return { sheets, items, summary, ledgerRows: parsed.ledger.length, ledgerSheet: parsed.ledgerSheet };
  }

  /** Simpan keputusan pemetaan sebagai aturan (key = mappingKey grup atau sourceRef item). */
  async saveDecisions(decisions: Record<string, RabDecision>, projectByKey: Map<string, string>, userId: string | null) {
    for (const [key, d] of Object.entries(decisions)) {
      const projectId = projectByKey.get(key);
      if (!projectId) continue;
      const data = {
        projectId,
        scope: d.scope,
        clusterId: d.scope === 'CLUSTER' ? (d.clusterId ?? null) : null,
        clusterIds: d.scope === 'PROJECT' ? (d.clusterIds ?? []) : [],
        method: d.scope === 'PROJECT' ? (d.method ?? 'EQUAL') : null,
        category: d.category ?? null,
        createdById: userId,
      };
      const before = await this.prisma.importMappingRule.findUnique({ where: { sourceKey: key } });
      await this.prisma.importMappingRule.upsert({ where: { sourceKey: key }, create: { sourceKey: key, ...data }, update: data });
      await this.audit.diff(this.prisma, userId, 'ImportMappingRule', key, before ? { scope: before.scope, clusterId: before.clusterId, clusterIds: before.clusterIds.join(','), method: before.method, category: before.category } : null, {
        scope: data.scope,
        clusterId: data.clusterId,
        clusterIds: data.clusterIds.join(','),
        method: data.method,
        category: data.category,
      });
    }
  }

  async commit(parsed: ParsedRab, decisions: Record<string, RabDecision>, userId: string | null, allowedProjectIds?: string[]) {
    // proyek untuk setiap kunci keputusan
    const first = await this.preview(parsed, allowedProjectIds);
    const projectByKey = new Map<string, string>();
    for (const i of first.items) {
      if (!i.projectId) continue;
      projectByKey.set(i.mappingKey, i.projectId);
      projectByKey.set(sourceRefOf(i), i.projectId);
    }
    await this.saveDecisions(decisions, projectByKey, userId);
    const preview = await this.preview(parsed, allowedProjectIds);

    let created = 0;
    let updated = 0;
    // grup alokasi: semua item siap dalam satu mappingKey + target yang sama dialokasikan kumulatif
    const groups = new Map<string, RabPreviewItem[]>();
    for (const i of preview.items) {
      if (!['NEW', 'CHANGED', 'UNCHANGED'].includes(i.status)) continue;
      const t = i.target!;
      const gk = t.scope === 'PROJECT' ? `${i.mappingKey}|${[...t.clusterIds].sort().join(',')}|${t.method}` : `item|${i.key}`;
      groups.set(gk, [...(groups.get(gk) ?? []), i]);
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const group of groups.values()) {
          const sorted = [...group].sort((a, b) => a.row - b.row || a.cell.localeCompare(b.cell));
          const t = sorted[0].target!;
          const projectId = sorted[0].projectId!;
          const alloc = await this.support.computeGroup(
            sorted.map((i) => i.amount),
            t.scope === 'CLUSTER' ? { projectId, clusterId: t.clusterId } : { projectId, clusterIds: (t as { clusterIds: string[] }).clusterIds, method: (t as { method: AllocationMethod }).method },
            tx,
          );
          for (let k = 0; k < sorted.length; k++) {
            const it = sorted[k];
            if (it.status === 'UNCHANGED') continue;
            const budgetCode = await this.support.resolveBudgetCode(projectId, it.category!, null, tx);
            const data = {
              projectId,
              clusterId: t.scope === 'CLUSTER' ? t.clusterId : null,
              date: it.date ? new Date(`${it.date}T00:00:00Z`) : null,
              periodLabel: it.periodText,
              category: it.category!,
              budgetCode,
              description: descOf(it),
              amount: money(it.amount),
              allocationMethod: t.scope === 'PROJECT' ? alloc.method : null,
              status: 'TERVERIFIKASI' as const,
              source: 'IMPORT_RAB' as const,
              verifiedById: userId,
              verifiedAt: new Date(),
            };
            const before = await tx.expense.findUnique({ where: { sourceRef: sourceRefOf(it) }, include: { allocations: true } });
            const e = before
              ? await tx.expense.update({ where: { id: before.id }, data })
              : await tx.expense.create({ data: { ...data, sourceRef: sourceRefOf(it), createdById: userId } });
            await this.support.writeAllocations(tx, e.id, alloc.lines[k]);
            const after = await tx.expense.findUniqueOrThrow({ where: { id: e.id }, include: { allocations: true } });
            await this.audit.diff(tx, userId, 'Expense', e.id, flatExpense(before), { ...flatExpense(after)!, source: `import-rab:${it.key}` });
            if (before) updated++;
            else created++;
          }
        }
      },
      { timeout: 180_000 },
    );
    return { created, updated, preview: await this.preview(parsed, allowedProjectIds) };
  }
}
