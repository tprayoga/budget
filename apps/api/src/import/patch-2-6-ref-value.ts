import type { PrismaClient } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';

export const PATCH_26 = '2.6-nilai-referensi-per-client';
const ALASAN = 'keputusan user penutup Fase 2: RAB EVANTAMA mencatat nilai net (DPP + PPN − PPh) untuk semua status';

/** Client EVANTAMA: referensi tagihan RAB bernilai NET. ADW & CCSI tetap INVOICE_TOTAL (default). Idempotent, diaudit. */
export async function applyPatch26(prisma: PrismaClient, audit: AuditService, userId: string | null): Promise<string[]> {
  if (await prisma.dataPatch.findUnique({ where: { name: PATCH_26 } })) return [];
  const ev = await prisma.client.findUnique({ where: { name: 'PT Evantama Network System' } });
  if (!ev) return ['Patch 2.6 ditunda: client Evantama belum ada'];
  const log: string[] = [];
  await prisma.$transaction(async (tx) => {
    if (ev.referenceValueType !== 'NET') {
      await tx.client.update({ where: { id: ev.id }, data: { referenceValueType: 'NET' } });
      await audit.diff(tx, userId, 'Client', ev.id, { referenceValueType: ev.referenceValueType, alasan: null }, { referenceValueType: 'NET', alasan: ALASAN });
      log.push('Client Evantama: referensi RAB = NET');
    }
    await tx.dataPatch.create({ data: { name: PATCH_26, note: log.join('; ') || 'sudah NET' } });
  });
  return log;
}
