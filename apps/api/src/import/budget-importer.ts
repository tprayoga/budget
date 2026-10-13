import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  BUDGET_LABEL,
  BUDGET_LINE_CODES,
  calcCluster,
  dec,
  moneyStr,
  RATE_DP,
} from '@indotek/shared';
import { parseBudgetWorkbook, type ParsedCluster, type ParsedWorkbook } from '@indotek/shared/xlsx';
import type { AuditService } from '../audit/audit.service';
import type { SettingsService } from '../settings/settings.service';
import { money, rate, s } from '../common/decimal';

export type ImportClusterStatus = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'MISSING_IN_FILE';

export interface ImportDiff {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

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

function flatDb(c: DbCluster): Record<string, string | null> {
  const o: Record<string, string | null> = {
    info: c.info,
    division: c.division,
    nilaiPoImpl: n(s(c.nilaiPoImpl)),
    nilaiPoPermit: n(s(c.nilaiPoPermit)),
    permitCost: n(s(c.permitCost)),
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

  loadProjectClusters(projectId: string) {
    return this.prisma.cluster.findMany({ where: { projectId }, include: { budgetLines: true } });
  }

  async preview(parsed: ParsedWorkbook, allowedProjectIds?: string[]): Promise<ImportPreview> {
    const out: ImportPreview = {
      sheets: [],
      clusters: [],
      assumptions: { interestRate: parsed.interestRate, retensiAsCost: parsed.retensiAsCost },
    };
    for (const sheet of parsed.projects) {
      const project = await this.prisma.project.findUnique({ where: { code: sheet.projectCode } });
      const summary: Record<ImportClusterStatus, number> = { NEW: 0, CHANGED: 0, UNCHANGED: 0, MISSING_IN_FILE: 0 };
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
          .filter((d) => !prev || storedForm(d.field, d.oldValue) !== storedForm(d.field, d.newValue));
        const status: ImportClusterStatus = !db ? 'NEW' : diffs.length ? 'CHANGED' : 'UNCHANGED';
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

  /** Terapkan cluster NEW/CHANGED (opsional hanya `keys` tertentu) dalam satu transaksi + audit log. */
  async commit(parsed: ParsedWorkbook, userId: string | null, keys?: string[], allowedProjectIds?: string[]) {
    const preview = await this.preview(parsed, allowedProjectIds);
    const wanted = new Set(
      preview.clusters
        .filter((c) => c.status === 'NEW' || c.status === 'CHANGED')
        .filter((c) => !keys?.length || keys.includes(c.key))
        .map((c) => c.key),
    );
    let created = 0;
    let updated = 0;
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
              include: { budgetLines: true },
            });
            const data = {
              info: c.info,
              division: c.division,
              nilaiPoImpl: money(c.nilaiPoImpl),
              nilaiPoPermit: money(c.nilaiPoPermit),
              permitCost: money(c.permitCost),
              pajakRate: rate(c.pajakRate),
              retensiRate: rate(c.retensiRate),
            };
            const cluster = db
              ? await tx.cluster.update({ where: { id: db.id }, data })
              : await tx.cluster.create({
                  data: { ...data, projectId, name: c.name, status: 'ONGOING', sortOrder: ++order },
                });
            for (const l of c.lines) {
              const values = {
                mode: l.mode,
                pct: l.mode === 'PCT' ? rate(l.pct ?? 0) : null,
                amount: l.mode === 'RP' ? money(l.amount ?? 0) : null,
              };
              await tx.budgetLine.upsert({
                where: { clusterId_code: { clusterId: cluster.id, code: l.code } },
                create: {
                  clusterId: cluster.id,
                  code: l.code,
                  label: BUDGET_LABEL[l.code],
                  sortOrder: BUDGET_LINE_CODES.indexOf(l.code),
                  ...values,
                },
                update: values,
              });
            }
            await this.audit.diff(tx, userId, 'Cluster', cluster.id, db ? flatDb(db) : null, {
              ...(db ? {} : { name: c.name, status: 'ONGOING' }),
              ...flatParsed(c),
              source: 'import-xlsx',
            });
            if (db) updated++;
            else created++;
          }
        }
      },
      { timeout: 120_000 },
    );
    return { created, updated, preview: await this.preview(parsed, allowedProjectIds) };
  }
}
