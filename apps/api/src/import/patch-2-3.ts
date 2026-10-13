import type { PrismaClient } from '@prisma/client';
import type { HeldReleaseInput } from '@indotek/shared';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { money } from '../common/decimal';
import { ensureClusterPos, linkOrphanTermins, markOverride, poFlat, poRef, syncDerivedFromPos } from '../clusters/po-support';
import { generateClientPayments } from '../realization/termin-generator';
import { ExpenseSupportService } from '../realization/expense-support.service';
import { saveRule } from './rab-importer';
import { releaseHeldExpense } from './held-items.service';
import { PATCH_22 } from './patch-2-2';
import { scanOverruns } from '../notifications/overrun';

export const PATCH_23 = '2.3-po-permit-semarang-fee-marketing';

const KONFIRMASI = 'konfirmasi user 14 Okt 2026';
const MANADO = { kal: 'Kalawiran Kakas Barat (Manado)', kar: 'Karondoran Langowan Timur (Manado)' };
const SEMARANG = 'Padangsari RW 12 & 13 (Semarang)';
const SND = { ref: 'MANUAL:CCSI!F32', poRef: 'PO:CCSI!F32', poNumber: 'FTTHSWI-5-280926', amount: '4373496', invoiceNo: 'INV-RAA/003/IX/2026' };
const SEMARANG_PERMIT = '36000000';

/**
 * Keputusan review Fase 2.2 (sekali, idempotent lewat DataPatch, semua perubahan diaudit):
 *  1. Semua cluster punya PO (migrasi dari nilai lama, nomor PO dari info); termin lama dikaitkan ke PO.
 *  2. Field permit Manado (keputusan 2.2) ditandai "diedit di aplikasi" → dilindungi dari import budget.
 *  3. SND Kalawiran: PO SND FTTHSWI-5-280926 4.373.496 (pass-through 0) + termin SND 1×100% Unpaid; item ditahan → RELEASED.
 *  4. Permit Semarang pass-through: PO PERMIT 36.000.000 / passThroughCost 36.000.000 + termin manual 1×100% UNBILLED
 *     (tanggal invoice kosong); J31 dilepas → PERMIT 100% Semarang.
 *  5. C58 "Wenda Manado Sulut" 4.000.000 = fee marketing → kategori MARKETING_FEE, PRO_RATA_PO Kalawiran & Karondoran.
 * Setelah patch, daftar "Ditahan" kosong.
 */
export async function applyPatch23(prisma: PrismaClient, audit: AuditService, userId: string | null): Promise<string[]> {
  if (await prisma.dataPatch.findUnique({ where: { name: PATCH_23 } })) return [];
  if (!(await prisma.dataPatch.findUnique({ where: { name: PATCH_22 } }))) return ['Patch 2.3 ditunda: patch 2.2 belum diterapkan'];
  const ccsi = await prisma.project.findUnique({ where: { code: 'CCSI' } });
  if (!ccsi) return ['Patch 2.3 ditunda: project CCSI belum ada'];
  const find = (name: string) => prisma.cluster.findFirst({ where: { projectId: ccsi.id, name } });
  const [kal, kar, semarang] = await Promise.all([find(MANADO.kal), find(MANADO.kar), find(SEMARANG)]);
  if (!kal || !kar || !semarang) return ['Patch 2.3 ditunda: cluster CCSI contoh belum lengkap'];
  const support = new ExpenseSupportService(prisma as unknown as PrismaService);
  const log: string[] = [];

  await prisma.$transaction(
    async (tx) => {
      // 1) PO dasar untuk semua cluster + tautkan termin lama
      let migrated = 0;
      for (const c of await tx.cluster.findMany({ select: { id: true } })) {
        const had = await tx.clusterPo.count({ where: { clusterId: c.id } });
        await ensureClusterPos(tx, c.id);
        await linkOrphanTermins(tx, c.id);
        if (!had) migrated++;
      }
      log.push(`PO dasar dibuat untuk ${migrated} cluster`);

      // 2) field permit Manado = keputusan 2.2 → dilindungi
      for (const c of [kal, kar]) await markOverride(tx, c.id, ['nilaiPoPermit', 'permitCost'], userId, 'permit pass-through dari sheet CCSI (keputusan 2.2)');

      // 3) SND Kalawiran
      let snd = await tx.clusterPo.findUnique({ where: { sourceRef: SND.poRef } });
      if (!snd) {
        snd = await tx.clusterPo.create({
          data: { clusterId: kal.id, kind: 'SND', poNumber: SND.poNumber, amount: money(SND.amount), passThroughCost: money(0), sourceRef: SND.poRef, note: `PO SND terpisah (sheet CCSI E6/F32) — ${KONFIRMASI}` },
        });
        await audit.diff(tx, userId, 'ClusterPo', snd.id, null, { ...poFlat(snd)!, sumber: SND.ref });
        const d = await syncDerivedFromPos(tx, kal.id);
        await audit.diff(tx, userId, 'Cluster', kal.id, d.before, { ...d.after, alasan: `PO SND ${SND.poNumber} — ${KONFIRMASI}` });
        await generateClientPayments(tx, kal.id, snd.id);
        const t = await tx.clientPayment.findUnique({ where: { poId_termin: { poId: snd.id, termin: 1 } } });
        if (t) {
          await tx.clientPayment.update({ where: { id: t.id }, data: { invoiceNo: SND.invoiceNo, status: 'INVOICED', keterangan: 'SND 100% (sheet CCSI: Unpaid)' } });
          await audit.diff(tx, userId, 'ClientPayment', t.id, { invoiceNo: null, status: t.status }, { invoiceNo: SND.invoiceNo, status: 'INVOICED', alasan: 'sheet CCSI: Unpaid' });
        }
        log.push(`SND Kalawiran: PO ${SND.poNumber} ${SND.amount}, termin SND INVOICED (tanggal invoice kosong)`);
      }
      const sndHeld = await tx.importHeldItem.findUnique({ where: { sourceRef: SND.ref } });
      if (sndHeld && sndHeld.status === 'HELD') {
        await tx.importHeldItem.update({ where: { id: sndHeld.id }, data: { status: 'RELEASED', resolution: 'PO_SND', note: `dicatat sebagai PO SND ${SND.poNumber}`, resolvedById: userId, resolvedAt: new Date() } });
        await audit.diff(tx, userId, 'ImportHeldItem', sndHeld.id, { status: 'HELD' }, { status: 'RELEASED', resolution: 'PO_SND' });
      }

      // 4) Permit Semarang pass-through
      const semRef = poRef(semarang.id, 'PERMIT');
      let semPo = await tx.clusterPo.findFirst({ where: { clusterId: semarang.id, kind: 'PERMIT' } });
      if (!semPo) {
        semPo = await tx.clusterPo.create({
          data: { clusterId: semarang.id, kind: 'PERMIT', amount: money(SEMARANG_PERMIT), passThroughCost: money(SEMARANG_PERMIT), sourceRef: semRef, note: KONFIRMASI },
        });
        await audit.diff(tx, userId, 'ClusterPo', semPo.id, null, { ...poFlat(semPo)!, alasan: KONFIRMASI });
        const d = await syncDerivedFromPos(tx, semarang.id);
        await audit.diff(tx, userId, 'Cluster', semarang.id, d.before, { ...d.after, alasan: `permit pass-through Semarang — ${KONFIRMASI}` });
        await markOverride(tx, semarang.id, ['nilaiPoPermit', 'permitCost'], userId, KONFIRMASI);
        // CCSI tanpa template → termin manual 1 × 100%, UNBILLED, tanggal invoice kosong
        const t = await tx.clientPayment.create({
          data: { clusterId: semarang.id, poId: semPo.id, fromTemplate: false, kind: 'PERMIT', termin: 1, pct: '1', amount: money(SEMARANG_PERMIT), keterangan: 'Permit 100%' },
        });
        await audit.diff(tx, userId, 'ClientPayment', t.id, null, { kind: 'PERMIT', termin: '1', amount: SEMARANG_PERMIT, status: 'UNBILLED', alasan: KONFIRMASI });
        log.push('Semarang: PO PERMIT 36.000.000 pass-through + termin permit UNBILLED');
      }

      // 5) aturan import: J31 → PERMIT Semarang; C58 → fee marketing pro-rata PO Manado
      const j31: HeldReleaseInput = { scope: 'CLUSTER', clusterId: semarang.id, category: 'PERMIT', note: `permit Semarang pass-through — ${KONFIRMASI}` };
      const c58: HeldReleaseInput = { scope: 'PROJECT', method: 'PRO_RATA_PO', clusterIds: [kal.id, kar.id], category: 'MARKETING_FEE', note: `fee marketing — ${KONFIRMASI}` };
      for (const [cell, d] of [['J31', j31], ['C58', c58]] as const) {
        const ref = `RAB:CCSI!${cell}`;
        const held = await tx.importHeldItem.findUnique({ where: { sourceRef: ref } });
        if (held?.status === 'HELD') {
          await releaseHeldExpense(tx, audit, support, held, d, userId);
          log.push(`${cell} dilepas (${d.category})`);
        } else {
          await saveRule(tx, audit, ref, ccsi.id, d, userId);
          log.push(`aturan ${cell} → ${d.category}`);
        }
      }

      await tx.dataPatch.create({ data: { name: PATCH_23, note: log.join('; ') } });
    },
    { timeout: 120_000 },
  );
  await scanOverruns(prisma);
  return log;
}
