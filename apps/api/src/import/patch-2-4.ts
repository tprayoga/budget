import type { PrismaClient } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import { syncDerivedFromPos } from '../clusters/po-support';
import { scanOverruns } from '../notifications/overrun';
import { PATCH_23 } from './patch-2-3';

export const PATCH_24 = '2.4-ppn-notifikasi-tepas';

const TEPAS_REV = 'Distribusi - TEPAS RW 05 NGAWI -REV';
export const TEPAS_NOTE = 'PO 33.655.100 dikonfirmasi user 14 Okt 2026; nilai 33.650.100 di kolom Realisasi sheet tidak dipakai';

/**
 * Keputusan review Fase 2.3 (sekali, idempotent lewat DataPatch, diaudit):
 *  1. Catatan konfirmasi PO TEPAS RW 05 NGAWI-REV (PO 33.655.100 sesuai dokumen PO/2026/09245).
 *  2. Nilai turunan permitPoAmount (Σ PO PERMIT, dasar margin permit tanpa SND) disinkronkan untuk semua cluster.
 *  3. Notifikasi over budget lama (per pos, aturan 2.3) dibersihkan; pemindaian ulang dengan aturan baru
 *     (TOTAL ≥ ambang langsung, pos → ringkasan harian).
 */
export async function applyPatch24(prisma: PrismaClient, audit: AuditService, userId: string | null): Promise<string[]> {
  if (await prisma.dataPatch.findUnique({ where: { name: PATCH_24 } })) return [];
  if (!(await prisma.dataPatch.findUnique({ where: { name: PATCH_23 } }))) return ['Patch 2.4 ditunda: patch 2.3 belum diterapkan'];
  const log: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      const tepas = await tx.cluster.findFirst({ where: { name: TEPAS_REV, project: { code: 'ADW' } } });
      if (tepas && tepas.note !== TEPAS_NOTE) {
        await tx.cluster.update({ where: { id: tepas.id }, data: { note: TEPAS_NOTE } });
        await audit.diff(tx, userId, 'Cluster', tepas.id, { note: tepas.note, alasan: null }, { note: TEPAS_NOTE, alasan: 'konfirmasi user 14 Okt 2026 (dokumen PO/2026/09245)' });
        log.push('catatan PO TEPAS RW 05 NGAWI-REV');
      }
      for (const c of await tx.cluster.findMany({ select: { id: true } })) await syncDerivedFromPos(tx, c.id);
      log.push('permitPoAmount disinkronkan');
      const old = await tx.notification.deleteMany({ where: { type: { in: ['OVER_BUDGET', 'OVER_BUDGET_DIGEST'] } } });
      await tx.overrunState.deleteMany({});
      log.push(`${old.count} notifikasi over budget lama dihapus`);
      await tx.dataPatch.create({ data: { name: PATCH_24, note: log.join('; ') } });
    },
    { timeout: 120_000 },
  );
  const scan = await scanOverruns(prisma);
  log.push(`pemindaian ulang: ${scan.over} pos/cluster over, ${scan.crossedTotal} total cluster (langsung), ${scan.crossedPos} pos (ringkasan harian), ${scan.notifications} notifikasi`);
  await prisma.dataPatch.update({ where: { name: PATCH_24 }, data: { note: log.join('; ') } });
  return log;
}
