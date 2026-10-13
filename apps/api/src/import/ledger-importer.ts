import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { LedgerRow } from '@indotek/shared/xlsx';
import type { AuditService } from '../audit/audit.service';
import { money } from '../common/decimal';

/**
 * Import buku kas (sheet TELCO - OPS). Nilai yang dibaca adalah cache IMPORTRANGE, bukan formula.
 * Baris tidak pernah diubah; kunci idempotensi = hash(sheet, tanggal, deskripsi, project, in, out, urutan duplikat).
 * Project dicocokkan persis dengan kode project (ADW/EVANTAMA/CCSI); label lain (RPJ, IKR, OPS BTS, …) disimpan apa adanya.
 */
export class LedgerImporter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  private keyed(rows: LedgerRow[]) {
    const seen = new Map<string, number>();
    return rows.map((r) => {
      const base = [r.sheet, r.date, r.description, r.projectLabel ?? '', r.cashIn, r.cashOut].join('|');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...r, sourceKey: createHash('sha256').update(`${base}|${n}`).digest('hex') };
    });
  }

  async preview(rows: LedgerRow[]) {
    const keyed = this.keyed(rows);
    const projects = await this.prisma.project.findMany({ select: { id: true, code: true } });
    const byCode = new Map(projects.map((p) => [p.code, p.id]));
    const existing = new Set(
      (await this.prisma.cashLedger.findMany({ where: { sourceKey: { in: keyed.map((k) => k.sourceKey) } }, select: { sourceKey: true } })).map((x) => x.sourceKey),
    );
    const items = keyed.map((r) => ({
      ...r,
      projectId: r.projectLabel ? (byCode.get(r.projectLabel.trim().toUpperCase()) ?? null) : null,
      status: existing.has(r.sourceKey) ? ('EXISTING' as const) : ('NEW' as const),
    }));
    const byLabel: Record<string, { rows: number; matched: boolean }> = {};
    for (const i of items) {
      const k = i.projectLabel ?? '(kosong)';
      byLabel[k] = { rows: (byLabel[k]?.rows ?? 0) + 1, matched: !!i.projectId };
    }
    return {
      items,
      summary: { total: items.length, new: items.filter((i) => i.status === 'NEW').length, existing: existing.size },
      projectLabels: byLabel,
    };
  }

  async commit(rows: LedgerRow[], userId: string | null) {
    const { items } = await this.preview(rows);
    const fresh = items.filter((i) => i.status === 'NEW');
    if (fresh.length) {
      await this.prisma.cashLedger.createMany({
        data: fresh.map((r) => ({
          date: new Date(`${r.date}T00:00:00Z`),
          description: r.description,
          projectId: r.projectId,
          projectLabel: r.projectLabel,
          cashAccount: r.cashAccount,
          accountName: r.accountName,
          cashIn: money(r.cashIn),
          cashOut: money(r.cashOut),
          sourceKey: r.sourceKey,
          sourceSheet: r.sheet,
          sourceRow: r.row,
        })),
        skipDuplicates: true,
      });
      await this.audit.log(this.prisma, userId, [{ entity: 'CashLedger', entityId: 'import', field: 'rows', oldValue: null, newValue: `${fresh.length} baris baru` }]);
    }
    return { created: fresh.length, ...(await this.preview(rows)).summary };
  }
}
