import type { AllocationMethod, Cluster, ExpenseCategory, ImportMappingRule, Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { dec, type RabDecision } from '@indotek/shared';
import { clusterNameKey, parseRabWorkbook, type ParsedRab, type RabExpenseItem } from '@indotek/shared/xlsx';
import type { AuditService } from '../audit/audit.service';
import type { ExpenseSupportService } from '../realization/expense-support.service';
import { flatExpense } from '../realization/expenses.service';
import { money } from '../common/decimal';

export type ManualPct = { clusterId: string; pct: string };

export type RabTarget =
  | { scope: 'CLUSTER'; clusterId: string; clusterName: string }
  | { scope: 'PROJECT'; clusterIds: string[]; clusterNames: string[]; method: AllocationMethod; manualPcts?: ManualPct[]; clusterFilter?: string | null }
  | { scope: 'SKIP' | 'HOLD' | 'DUPLICATE'; note: string | null };

export type RabItemStatus = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'NEEDS_MAPPING' | 'SKIPPED' | 'HELD' | 'DUPLICATE';

export interface RabPreviewItem extends RabExpenseItem {
  projectCode: string;
  projectId: string | null;
  /** Kunci keputusan grup/blok (target cluster). */
  mappingKey: string;
  target: RabTarget | null;
  targetSource: 'AUTO' | 'RULE' | null;
  suggestedTarget: RabTarget | null;
  /** Catatan dari keputusan (mis. alasan ditahan / duplikat / "kasbon — perlu penyelesaian"). */
  note: string | null;
  status: RabItemStatus;
  diffs: { field: string; oldValue: string | null; newValue: string | null }[];
}

export const sourceRefOf = (item: { key: string }) => `RAB:${item.key}`;

export function mappingKeyOf(item: RabExpenseItem): string {
  if (item.section === 'SUBCON') return `RAB:${item.sheet}:BLOCK:${item.blockTitle ?? '?'}`;
  return `RAB:${item.sheet}:${item.section}:${item.groupTitle ?? item.blockTitle ?? ''}`;
}

export const descOf = (i: { label: string; blockTitle: string | null; groupTitle: string | null }) => {
  const ctx = i.blockTitle ?? i.groupTitle;
  return ctx ? `${i.label} — ${ctx}` : i.label;
};

const isAllocTarget = (t: RabTarget | null): t is Extract<RabTarget, { scope: 'CLUSTER' | 'PROJECT' }> =>
  !!t && (t.scope === 'CLUSTER' || t.scope === 'PROJECT');

/** Target dari aturan/keputusan; null bila tidak lengkap. */
export function targetFromRule(
  rule: Pick<ImportMappingRule, 'scope' | 'clusterId' | 'clusterIds' | 'method' | 'note'> & {
    manualPcts?: Prisma.JsonValue | ManualPct[] | null;
    clusterFilter?: string | null;
  },
  clusters: Cluster[],
  itemDate?: string | null,
): RabTarget | null {
  if (rule.scope === 'SKIP' || rule.scope === 'HOLD' || rule.scope === 'DUPLICATE') return { scope: rule.scope, note: rule.note ?? null };
  if (rule.scope === 'CLUSTER' && rule.clusterId) {
    const c = clusters.find((x) => x.id === rule.clusterId);
    return c ? { scope: 'CLUSTER', clusterId: c.id, clusterName: c.name } : null;
  }
  if (rule.scope === 'PROJECT') {
    let list = rule.clusterIds.length ? clusters.filter((c) => rule.clusterIds.includes(c.id)) : clusters.filter((c) => c.status !== 'CANCELLED');
    if (rule.clusterFilter === 'IMPL_DATE_LE_EXPENSE' && itemDate) {
      // cluster yang sudah mulai implementasi pada tanggal expense; tanggal implementasi kosong ikut
      list = list.filter((c) => !c.implementationDate || c.implementationDate.toISOString().slice(0, 10) <= itemDate);
    }
    if (!list.length) return null;
    const method = rule.method ?? 'EQUAL';
    const manualPcts = method === 'MANUAL' ? ((rule.manualPcts as ManualPct[] | null) ?? []) : undefined;
    return {
      scope: 'PROJECT',
      clusterIds: list.map((c) => c.id),
      clusterNames: list.map((c) => c.name),
      method,
      ...(manualPcts ? { manualPcts } : {}),
      ...(rule.clusterFilter ? { clusterFilter: rule.clusterFilter } : {}),
    };
  }
  return null;
}

/**
 * Import realisasi dari file RAB. Item yang cluster/kategorinya tidak bisa ditentukan otomatis
 * berstatus NEEDS_MAPPING sampai pengguna memberi keputusan (disimpan sebagai ImportMappingRule).
 * Keputusan HOLD menyimpan item ke daftar "Ditahan — perlu konfirmasi" (ImportHeldItem) yang bisa dilepas
 * kemudian tanpa import ulang; DUPLICATE/SKIP dilewati. Expense hasil import langsung TERVERIFIKASI.
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
        if (itemRule && itemRule.scope !== 'INHERIT') target = targetFromRule(itemRule, clusters, it.date);
        if (!target && groupRule && groupRule.scope !== 'INHERIT') target = targetFromRule(groupRule, clusters, it.date);
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
        if (!isAllocTarget(target)) {
          const words = clusterNameKey(it.groupTitle ?? it.blockTitle ?? '').split(' ').filter((w) => w.length > 3 && !['cluster', 'site', 'ccsi'].includes(w));
          const hits = active.filter((c) => words.some((w) => c.name.toLowerCase().includes(w)));
          const list = hits.length ? hits : active;
          if (list.length) suggestedTarget = { scope: 'PROJECT', clusterIds: list.map((c) => c.id), clusterNames: list.map((c) => c.name), method: 'EQUAL' };
        }
        const category = (itemRule?.category ?? groupRule?.category ?? it.category) as ExpenseCategory | null;
        const note = itemRule?.note ?? groupRule?.note ?? null;
        const prev = existing.get(sourceRefOf(it));
        let status: RabItemStatus;
        const diffs: RabPreviewItem['diffs'] = [];
        if (target?.scope === 'SKIP') status = 'SKIPPED';
        else if (target?.scope === 'HOLD') status = 'HELD';
        else if (target?.scope === 'DUPLICATE') status = 'DUPLICATE';
        else if (!isAllocTarget(target) || !category) status = 'NEEDS_MAPPING';
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
            ['note', prev.note, note],
          ];
          if (target.scope === 'PROJECT' && target.method === 'MANUAL') {
            const want = new Map((target.manualPcts ?? []).map((m) => [m.clusterId, dec(m.pct)]));
            const drift = prev.allocations.some((a) => !dec(a.pct.toString()).toDecimalPlaces(6).eq((want.get(a.clusterId) ?? dec(0)).toDecimalPlaces(6)));
            if (drift) cmp.push(['manualPcts', 'lama', 'baru']);
          }
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
          note,
          status,
          diffs,
        });
      }
    }
    const summary: Record<RabItemStatus, number> = { NEW: 0, CHANGED: 0, UNCHANGED: 0, NEEDS_MAPPING: 0, SKIPPED: 0, HELD: 0, DUPLICATE: 0 };
    for (const i of items) summary[i.status]++;
    return { sheets, items, summary, ledgerRows: parsed.ledger.length, ledgerSheet: parsed.ledgerSheet };
  }

  /** Simpan keputusan pemetaan sebagai aturan (key = mappingKey grup atau sourceRef item). */
  async saveDecisions(decisions: Record<string, RabDecision>, projectByKey: Map<string, string>, userId: string | null) {
    for (const [key, d] of Object.entries(decisions)) {
      const projectId = projectByKey.get(key);
      if (!projectId) continue;
      await saveRule(this.prisma, this.audit, key, projectId, d, userId);
    }
  }

  async commit(parsed: ParsedRab, decisions: Record<string, RabDecision>, userId: string | null, allowedProjectIds?: string[]) {
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
    let held = 0;
    let dismissed = 0;
    // grup alokasi: semua item siap dalam satu mappingKey + target yang sama dialokasikan kumulatif
    const groups = new Map<string, RabPreviewItem[]>();
    for (const i of preview.items) {
      if (!['NEW', 'CHANGED', 'UNCHANGED'].includes(i.status)) continue;
      const t = i.target as Extract<RabTarget, { scope: 'CLUSTER' | 'PROJECT' }>;
      // penerima dinamis per tanggal → dialokasikan per item
      const gk =
        t.scope === 'PROJECT' && !t.clusterFilter
          ? `${i.mappingKey}|${[...t.clusterIds].sort().join(',')}|${t.method}|${JSON.stringify(t.manualPcts ?? [])}`
          : `item|${i.key}`;
      groups.set(gk, [...(groups.get(gk) ?? []), i]);
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const group of groups.values()) {
          const sorted = [...group].sort((a, b) => a.row - b.row || a.cell.localeCompare(b.cell));
          const t = sorted[0].target as Extract<RabTarget, { scope: 'CLUSTER' | 'PROJECT' }>;
          const projectId = sorted[0].projectId!;
          const alloc = await this.support.computeGroup(
            sorted.map((i) => i.amount),
            t.scope === 'CLUSTER'
              ? { projectId, clusterId: t.clusterId }
              : { projectId, clusterIds: t.clusterIds, method: t.method, manualPcts: t.manualPcts },
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
              note: it.note,
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

        // sinkron daftar ditahan:
        //  - HELD → simpan data (bisa dilepas tanpa import ulang)
        //  - DUPLICATE / SKIPPED → simpan sebagai DISMISSED (bisa dibatalkan)
        //  - sudah terimpor (aturan berubah dari HOLD) → RELEASED
        for (const it of preview.items) {
          const ref = sourceRefOf(it);
          const prev = await tx.importHeldItem.findUnique({ where: { sourceRef: ref } });
          if (['NEW', 'CHANGED', 'UNCHANGED'].includes(it.status)) {
            if (prev && prev.status !== 'RELEASED') {
              const e = await tx.expense.findUnique({ where: { sourceRef: ref } });
              await tx.importHeldItem.update({ where: { id: prev.id }, data: { status: 'RELEASED', expenseId: e?.id ?? null, resolution: null, resolvedById: userId, resolvedAt: new Date() } });
              await this.audit.diff(tx, userId, 'ImportHeldItem', prev.id, { status: prev.status }, { status: 'RELEASED', sumber: 'aturan import' });
            }
            continue;
          }
          if (!['HELD', 'DUPLICATE', 'SKIPPED'].includes(it.status)) continue;
          const status = it.status === 'HELD' ? 'HELD' : 'DISMISSED';
          const resolution = it.status === 'DUPLICATE' ? 'DUPLICATE' : it.status === 'SKIPPED' ? 'SKIP' : null;
          if (prev?.status === 'RELEASED') continue;
          const data = {
            projectId: it.projectId!,
            sheet: it.sheet,
            cell: it.cell,
            section: it.section,
            blockTitle: it.blockTitle,
            groupTitle: it.groupTitle,
            label: it.label,
            date: it.date ? new Date(`${it.date}T00:00:00Z`) : null,
            periodLabel: it.periodText,
            amount: money(it.amount),
            suggestedCategory: it.category ?? it.suggestedCategory,
            suggestedTarget: (it.suggestedTarget ?? undefined) as Prisma.InputJsonValue | undefined,
            note: it.note,
            status,
            resolution,
          };
          if (prev) {
            if (prev.status !== status || prev.resolution !== resolution || prev.note !== it.note) {
              await this.audit.diff(tx, userId, 'ImportHeldItem', prev.id, { status: prev.status, resolution: prev.resolution }, { status, resolution });
            }
            await tx.importHeldItem.update({ where: { id: prev.id }, data });
          } else {
            const h = await tx.importHeldItem.create({ data: { ...data, sourceRef: ref } });
            await this.audit.diff(tx, userId, 'ImportHeldItem', h.id, null, { sourceRef: ref, amount: it.amount, status, resolution, note: it.note });
          }
          if (status === 'HELD') held++;
          else dismissed++;
        }
      },
      { timeout: 180_000 },
    );
    return { created, updated, held, dismissed, preview: await this.preview(parsed, allowedProjectIds) };
  }
}

/** Simpan/ganti satu aturan pemetaan + audit. */
export async function saveRule(
  db: PrismaClient | Prisma.TransactionClient,
  audit: AuditService,
  key: string,
  projectId: string,
  d: RabDecision,
  userId: string | null,
) {
  const alloc = d.scope === 'PROJECT';
  const data = {
    projectId,
    scope: d.scope,
    clusterId: d.scope === 'CLUSTER' ? (d.clusterId ?? null) : null,
    clusterIds: alloc ? (d.clusterIds ?? []) : [],
    method: alloc ? (d.method ?? 'EQUAL') : null,
    manualPcts: alloc && d.method === 'MANUAL' ? ((d.manualPcts ?? []) as Prisma.InputJsonValue) : undefined,
    clusterFilter: alloc ? (d.clusterFilter ?? null) : null,
    category: d.category ?? null,
    note: d.note ?? null,
    createdById: userId,
  };
  const before = await db.importMappingRule.findUnique({ where: { sourceKey: key } });
  await db.importMappingRule.upsert({ where: { sourceKey: key }, create: { sourceKey: key, ...data }, update: data });
  const flat = (r: { scope: string; clusterId: string | null; clusterIds: string[]; method: string | null; category: string | null; note: string | null }) => ({
    scope: r.scope,
    clusterId: r.clusterId,
    clusterIds: r.clusterIds.join(','),
    method: r.method,
    category: r.category,
    note: r.note,
  });
  await audit.diff(db, userId, 'ImportMappingRule', key, before ? flat(before) : null, flat(data));
}
