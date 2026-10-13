import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  BUDGET_LABEL,
  BUDGET_LINE_CODES,
  calcCluster,
  dec,
  moneyStr,
  sum,
  RATE_DP,
} from '@indotek/shared';
import { parseBudgetWorkbook, parseImplementationDate, type ParsedCluster, type ParsedWorkbook } from '@indotek/shared/xlsx';
import type { AuditService } from '../audit/audit.service';
import type { SettingsService } from '../settings/settings.service';
import { money, rate, s } from '../common/decimal';
import { ensureClusterPos, poRef, syncDerivedFromPos } from '../clusters/po-support';
import { generateClientPayments } from '../realization/termin-generator';
import type { Tx } from '../prisma/prisma.service';

/** PROTECTED = hanya ada perbedaan pada field yang dilindungi (diedit di aplikasi). */
export type ImportClusterStatus = 'NEW' | 'CHANGED' | 'PROTECTED' | 'UNCHANGED' | 'MISSING_IN_FILE';

export interface ImportDiff {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  /** Field diedit di aplikasi (atau tidak bisa dipetakan ke satu PO) → dilewati kecuali ADMIN menimpa dengan alasan. */
  protected?: boolean;
  protectedReason?: string | null;
  overriddenAt?: Date | null;
  overriddenBy?: string | null;
}

/** Penimpaan field dilindungi: { [clusterKey]: field[] } + alasan (khusus ADMIN). */
export interface ImportForce {
  fields: Record<string, string[]>;
  reason: string | null;
}

const PO_FIELDS = ['nilaiPoImpl', 'nilaiPoPermit', 'permitCost'] as const;

export interface ImportClusterPreview {
  key: string;
  projectCode: string;
  name: string;
  column: string | null;
  status: ImportClusterStatus;
  diffs: ImportDiff[];
  nilaiProyek: string;
  danaInvestor: string;
  profit: string;
}

export interface ImportPreview {
  sheets: {
    sheetName: string;
    projectCode: string;
    projectId: string | null;
    projectName: string | null;
    error: string | null;
    clusterCount: number;
    warnings: string[];
    summary: Record<ImportClusterStatus, number>;
  }[];
  clusters: ImportClusterPreview[];
  assumptions: { interestRate: string | null; retensiAsCost: boolean | null };
}

const keyOf = (projectCode: string, name: string) => `${projectCode}::${name}`;

/** Nilai pembanding (dinormalisasi agar "0.10" == "0.1"). */
function n(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return dec(v).toString();
}

type DbCluster = Awaited<ReturnType<BudgetImporter['loadProjectClusters']>>[number];

function flatParsed(c: ParsedCluster): Record<string, string | null> {
  const o: Record<string, string | null> = {
    info: c.info,
    division: c.division,
    nilaiPoImpl: n(c.nilaiPoImpl),
    nilaiPoPermit: n(c.nilaiPoPermit),
    permitCost: n(c.permitCost),
    pajakRate: n(c.pajakRate),
    retensiRate: n(c.retensiRate),
  };
  for (const l of c.lines) {
    o[`line.${l.code}.mode`] = l.mode;
    o[`line.${l.code}.pct`] = l.mode === 'PCT' ? n(l.pct) : null;
    o[`line.${l.code}.amount`] = l.mode === 'RP' ? n(l.amount) : null;
  }
  return o;
}

/**
 * Nilai PO pembanding: file budget hanya memuat PO dasar, jadi dibandingkan dengan PO IMPLEMENTASI / PERMIT saja
 * (ADDWORK/DEDUCTION/SND tidak ada di file dan tidak boleh dianggap perbedaan).
 */
function basePo(c: DbCluster) {
  if (!c.pos.length) return { nilaiPoImpl: c.nilaiPoImpl.toString(), nilaiPoPermit: c.nilaiPoPermit.toString(), permitCost: c.permitCost.toString(), implCount: 1, permitCount: 1 };
  const impl = c.pos.filter((p) => p.kind === 'IMPLEMENTASI');
  const permit = c.pos.filter((p) => p.kind === 'PERMIT');
  const sumOf = (xs: { toString(): string }[]) => sum(xs.map((x) => x.toString())).toString();
  return {
    nilaiPoImpl: sumOf(impl.map((p) => p.amount)),
    nilaiPoPermit: sumOf(permit.map((p) => p.amount)),
    permitCost: sumOf(permit.map((p) => p.passThroughCost)),
    implCount: impl.length,
    permitCount: permit.length,
  };
}

function flatDb(c: DbCluster): Record<string, string | null> {
  const b = basePo(c);
  const o: Record<string, string | null> = {
    info: c.info,
    division: c.division,
    nilaiPoImpl: n(b.nilaiPoImpl),
    nilaiPoPermit: n(b.nilaiPoPermit),
    permitCost: n(b.permitCost),
    pajakRate: n(s(c.pajakRate)),
    retensiRate: n(s(c.retensiRate)),
  };
  for (const code of BUDGET_LINE_CODES) {
    const l = c.budgetLines.find((x) => x.code === code);
    o[`line.${code}.mode`] = l?.mode ?? null;
    o[`line.${code}.pct`] = l?.mode === 'PCT' ? n(s(l.pct)) : null;
    o[`line.${code}.amount`] = l?.mode === 'RP' ? n(s(l.amount)) : null;
  }
  return o;
}

/**
 * Pembanding nilai setelah pembulatan penyimpanan (uang 2 desimal, rasio RATE_DP desimal),
 * agar file yang sama tidak dianggap berubah hanya karena presisi float Excel.
 */
function storedForm(field: string, v: string | null): string | null {
  if (v === null || !/^-?\d/.test(v)) return v;
  const isRate = field === 'pajakRate' || field === 'retensiRate' || field.endsWith('.pct');
  return dec(v).toDecimalPlaces(isRate ? RATE_DP : 2).toString();
}

/**
 * Import budget dari Excel (layout file contoh). Dipakai oleh endpoint /import/budget-xlsx dan seed.
 * Cluster dicocokkan berdasarkan (project code = nama sheet, nama cluster). Cluster yang tidak ada di file
 * tidak dihapus (hanya dilaporkan).
 */
export class BudgetImporter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async parse(buffer: Buffer | ArrayBuffer): Promise<ParsedWorkbook> {
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
    return parseBudgetWorkbook(wb);
  }

  loadProjectClusters(projectId: string, db: PrismaClient | Tx = this.prisma) {
    return db.cluster.findMany({ where: { projectId }, include: { budgetLines: true, pos: true } });
  }

  /** Field yang dilindungi per cluster: FieldOverride (diedit di aplikasi) atau PO yang tidak tunggal. */
  private async protections(db: PrismaClient | Tx, clusters: DbCluster[]) {
    const rows = await db.fieldOverride.findMany({ where: { entity: 'Cluster', entityId: { in: clusters.map((c) => c.id) } } });
    const users = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId!).filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const out = new Map<string, Map<string, { reason: string; at: Date | null; by: string | null }>>();
    for (const c of clusters) {
      const m = new Map<string, { reason: string; at: Date | null; by: string | null }>();
      const b = basePo(c);
      if (b.implCount > 1) m.set('nilaiPoImpl', { reason: 'lebih dari satu PO implementasi — ubah lewat tabel PO', at: null, by: null });
      if (b.permitCount > 1) {
        for (const f of ['nilaiPoPermit', 'permitCost']) m.set(f, { reason: 'lebih dari satu PO permit — ubah lewat tabel PO', at: null, by: null });
      }
      for (const r of rows.filter((x) => x.entityId === c.id)) {
        m.set(r.field, { reason: 'dilindungi — diedit di aplikasi', at: r.at, by: r.userId ? (users.get(r.userId) ?? null) : null });
      }
      out.set(c.id, m);
    }
    return out;
  }

  async preview(parsed: ParsedWorkbook, allowedProjectIds?: string[]): Promise<ImportPreview> {
    const out: ImportPreview = {
      sheets: [],
      clusters: [],
      assumptions: { interestRate: parsed.interestRate, retensiAsCost: parsed.retensiAsCost },
    };
    for (const sheet of parsed.projects) {
      const project = await this.prisma.project.findUnique({ where: { code: sheet.projectCode } });
      const summary: Record<ImportClusterStatus, number> = { NEW: 0, CHANGED: 0, PROTECTED: 0, UNCHANGED: 0, MISSING_IN_FILE: 0 };
      const denied = project && allowedProjectIds && !allowedProjectIds.includes(project.id);
      const entry = {
        sheetName: sheet.sheetName,
        projectCode: sheet.projectCode,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        error: !project
          ? `Project dengan kode ${sheet.projectCode} belum ada. Buat project terlebih dahulu.`
          : denied
            ? 'Tidak punya akses ke project ini'
            : null,
        clusterCount: sheet.clusters.length,
        warnings: sheet.warnings,
        summary,
      };
      out.sheets.push(entry);
      if (!project || denied) continue;

      const setting = await this.settings.effective(project.id, this.prisma);
      const existing = await this.loadProjectClusters(project.id);
      const prot = await this.protections(this.prisma, existing);
      const byName = new Map(existing.map((c) => [c.name, c]));
      const seen = new Set<string>();
      for (const c of sheet.clusters) {
        seen.add(c.name);
        const db = byName.get(c.name);
        const next = flatParsed(c);
        const prev = db ? flatDb(db) : null;
        const diffs: ImportDiff[] = Object.keys(next)
          .map((field) => ({
            field,
            oldValue: prev ? prev[field] : null,
            newValue: next[field],
          }))
          .filter((d) => !prev || storedForm(d.field, d.oldValue) !== storedForm(d.field, d.newValue))
          // nilai PO di file boleh = PO dasar (file asli) atau = total turunan termasuk SND/addwork/deduction (hasil export)
          .filter((d) => !db || !(PO_FIELDS as readonly string[]).includes(d.field) || storedForm(d.field, n(s(db[d.field as (typeof PO_FIELDS)[number]]))) !== storedForm(d.field, d.newValue))
          .map((d) => {
            const p = db ? prot.get(db.id)?.get(d.field) : undefined;
            return p ? { ...d, protected: true, protectedReason: p.reason, overriddenAt: p.at, overriddenBy: p.by } : d;
          });
        const open = diffs.filter((d) => !d.protected);
        const status: ImportClusterStatus = !db ? 'NEW' : open.length ? 'CHANGED' : diffs.length ? 'PROTECTED' : 'UNCHANGED';
        summary[status]++;
        const calc = calcCluster({ ...c, interestRate: setting.interestRate, retensiAsCost: setting.retensiAsCost });
        out.clusters.push({
          key: keyOf(sheet.projectCode, c.name),
          projectCode: sheet.projectCode,
          name: c.name,
          column: c.column,
          status,
          diffs: status === 'NEW' ? [] : diffs,
          nilaiProyek: moneyStr(calc.nilaiProyek),
          danaInvestor: moneyStr(calc.danaInvestor.amount),
          profit: moneyStr(calc.profit),
        });
      }
      for (const db of existing.filter((x) => !seen.has(x.name))) {
        summary.MISSING_IN_FILE++;
        out.clusters.push({
          key: keyOf(sheet.projectCode, db.name),
          projectCode: sheet.projectCode,
          name: db.name,
          column: null,
          status: 'MISSING_IN_FILE',
          diffs: [],
          nilaiProyek: '0.00',
          danaInvestor: '0.00',
          profit: '0.00',
        });
      }
    }
    return out;
  }

  /**
   * Terapkan cluster NEW/CHANGED (opsional hanya `keys` tertentu) dalam satu transaksi + audit log.
   * Field yang dilindungi (diedit di aplikasi) dilewati, kecuali tercantum di `force` (ADMIN + alasan, dicek di controller).
   * Nilai PO ditulis ke PO dasar (IMPLEMENTASI / PERMIT) lalu nilai cluster diturunkan ulang.
   */
  async commit(parsed: ParsedWorkbook, userId: string | null, keys?: string[], allowedProjectIds?: string[], force?: ImportForce) {
    const preview = await this.preview(parsed, allowedProjectIds);
    const forced = (key: string, field: string) => !!force?.fields[key]?.includes(field);
    const byKey = new Map(preview.clusters.map((c) => [c.key, c]));
    const wanted = new Set(
      preview.clusters
        .filter((c) => c.status === 'NEW' || c.status === 'CHANGED' || (c.status === 'PROTECTED' && c.diffs.some((d) => forced(c.key, d.field))))
        .filter((c) => !keys?.length || keys.includes(c.key))
        .map((c) => c.key),
    );
    let created = 0;
    let updated = 0;
    let skippedProtected = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (const sheet of parsed.projects) {
          const info = preview.sheets.find((x) => x.sheetName === sheet.sheetName);
          if (!info?.projectId || info.error) continue;
          const projectId = info.projectId;
          let order = (await tx.cluster.aggregate({ where: { projectId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1;
          for (const c of sheet.clusters) {
            const key = keyOf(sheet.projectCode, c.name);
            if (!wanted.has(key)) continue;
            const db = await tx.cluster.findUnique({
              where: { projectId_name: { projectId, name: c.name } },
              include: { budgetLines: true, pos: true },
            });
            const next = flatParsed(c);
            if (!db) {
              const cluster = await tx.cluster.create({
                data: {
                  info: c.info,
                  division: c.division,
                  nilaiPoImpl: money(c.nilaiPoImpl),
                  nilaiPoPermit: money(c.nilaiPoPermit),
                  permitCost: money(c.permitCost),
                  pajakRate: rate(c.pajakRate),
                  retensiRate: rate(c.retensiRate),
                  projectId,
                  name: c.name,
                  status: 'ONGOING',
                  sortOrder: ++order,
                  implementationDate: (() => {
                    const d = parseImplementationDate(c.info);
                    return d ? new Date(`${d}T00:00:00Z`) : null;
                  })(),
                },
              });
              await this.writeLines(tx, cluster.id, c, () => true);
              await ensureClusterPos(tx, cluster.id);
              await generateClientPayments(tx, cluster.id);
              await this.audit.diff(tx, userId, 'Cluster', cluster.id, null, { name: c.name, status: 'ONGOING', ...next, source: 'import-xlsx' });
              created++;
              continue;
            }
            // field yang boleh ditulis: berbeda & (tidak dilindungi | dipaksa ADMIN)
            const diffs = byKey.get(key)?.diffs ?? [];
            const allowed = new Set(diffs.filter((d) => !d.protected || forced(key, d.field)).map((d) => d.field));
            skippedProtected += diffs.filter((d) => d.protected && !forced(key, d.field)).length;
            if (!allowed.size) continue;
            const before = flatDb(db);
            const data: Record<string, unknown> = {};
            if (allowed.has('info')) data.info = c.info;
            if (allowed.has('division')) data.division = c.division;
            if (allowed.has('pajakRate')) data.pajakRate = rate(c.pajakRate);
            if (allowed.has('retensiRate')) data.retensiRate = rate(c.retensiRate);
            if (Object.keys(data).length) await tx.cluster.update({ where: { id: db.id }, data });
            await this.writeLines(tx, db.id, c, (f) => allowed.has(f));
            if (PO_FIELDS.some((f) => allowed.has(f))) {
              await ensureClusterPos(tx, db.id);
              const pos = await tx.clusterPo.findMany({ where: { clusterId: db.id } });
              const impl = pos.filter((p) => p.kind === 'IMPLEMENTASI');
              const permit = pos.filter((p) => p.kind === 'PERMIT');
              if (allowed.has('nilaiPoImpl') && impl.length === 1) {
                await tx.clusterPo.update({ where: { id: impl[0].id }, data: { amount: money(c.nilaiPoImpl) } });
              }
              if ((allowed.has('nilaiPoPermit') || allowed.has('permitCost')) && permit.length <= 1) {
                const d: { amount?: ReturnType<typeof money>; passThroughCost?: ReturnType<typeof money> } = {};
                if (allowed.has('nilaiPoPermit')) d.amount = money(c.nilaiPoPermit);
                if (allowed.has('permitCost')) d.passThroughCost = money(c.permitCost);
                if (permit.length) await tx.clusterPo.update({ where: { id: permit[0].id }, data: d });
                else {
                  await tx.clusterPo.create({
                    data: { clusterId: db.id, kind: 'PERMIT', amount: d.amount ?? money(0), passThroughCost: d.passThroughCost ?? money(0), sourceRef: poRef(db.id, 'PERMIT'), note: 'dari import budget' },
                  });
                }
              }
              await syncDerivedFromPos(tx, db.id);
            }
            const forcedHere = [...allowed].filter((f) => forced(key, f));
            if (forcedHere.length) {
              await tx.fieldOverride.deleteMany({ where: { entity: 'Cluster', entityId: db.id, field: { in: forcedHere } } });
            }
            const after = flatDb((await tx.cluster.findUniqueOrThrow({ where: { id: db.id }, include: { budgetLines: true, pos: true } })) as DbCluster);
            await this.audit.diff(tx, userId, 'Cluster', db.id, before, {
              ...after,
              source: 'import-xlsx',
              ...(forcedHere.length ? { ditimpaAdmin: forcedHere.join(','), alasan: force?.reason ?? null } : {}),
            });
            updated++;
          }
        }
      },
      { timeout: 120_000 },
    );
    return { created, updated, skippedProtected, preview: await this.preview(parsed, allowedProjectIds) };
  }

  private async writeLines(tx: Tx, clusterId: string, c: ParsedCluster, ok: (field: string) => boolean) {
    for (const l of c.lines) {
      const fields = [`line.${l.code}.mode`, `line.${l.code}.pct`, `line.${l.code}.amount`];
      if (!fields.some(ok)) continue;
      const values = {
        mode: l.mode,
        pct: l.mode === 'PCT' ? rate(l.pct ?? 0) : null,
        amount: l.mode === 'RP' ? money(l.amount ?? 0) : null,
      };
      await tx.budgetLine.upsert({
        where: { clusterId_code: { clusterId, code: l.code } },
        create: { clusterId, code: l.code, label: BUDGET_LABEL[l.code], sortOrder: BUDGET_LINE_CODES.indexOf(l.code), ...values },
        update: values,
      });
    }
  }
}
