import type { PrismaClient } from '@prisma/client';
import { allocate, dec, rateStr, RATE_DP, type RabDecision } from '@indotek/shared';
import { parseImplementationDate } from '@indotek/shared/xlsx';
import type { AuditService } from '../audit/audit.service';
import { money } from '../common/decimal';
import { saveRule } from './rab-importer';
import { terminTaxDefaults } from '../realization/termin-generator';
import { ensureClusterPos, poRef, syncDerivedFromPos } from '../clusters/po-support';

export const PATCH_22 = '2.2-keputusan-import';
const REASON_PERMIT = 'permit pass-through dari sheet CCSI';

const MANADO = { kal: 'Kalawiran Kakas Barat (Manado)', kar: 'Karondoran Langowan Timur (Manado)' };
const PERMIT_PO = { kal: '10212800', kar: '12176000' }; // sheet CCSI E5/G5 = F30/F31
const PERMIT_INVOICE = { kal: 'INV-RAA/001/IX/2026', kar: 'INV-RAA/002/IX/2026' };
const PERMIT_REALISASI = '22000000'; // CCSI!D31
const PEMALANG = ['PULLING DISTRIBUSI DUSUN MANGUNSARI TEGALSARI BARAT PEMALANG', 'PULLING SUBFEEDER DUSUN MANGUNSARI TEGALSARI BARAT PEMALANG'];
const SEMARANG = 'Padangsari RW 12 & 13 (Semarang)';

/** Porsi permit Manado (rasio 12 desimal, Σ = 1) — dasar alokasi MANUAL realisasi permit & permitCost budget. */
export function manadoPermitPcts(kalId: string, karId: string) {
  const total = dec(PERMIT_PO.kal).plus(PERMIT_PO.kar);
  const p1 = dec(rateStr(dec(PERMIT_PO.kal).div(total))).toDecimalPlaces(RATE_DP);
  return [
    { clusterId: kalId, pct: p1.toString() },
    { clusterId: karId, pct: dec(1).minus(p1).toString() },
  ];
}

/**
 * Keputusan review Fase 2.1 (diterapkan sekali, idempotent lewat tabel DataPatch):
 * aturan pemetaan import RAB, budget & termin permit CCSI Manado, item SND ditahan, dan tanggal implementasi cluster.
 * Semua perubahan tercatat di AuditLog. Bila cluster contoh belum ada, patch ditunda (tidak ditandai selesai).
 */
export async function applyPatch22(prisma: PrismaClient, audit: AuditService, userId: string | null): Promise<string[]> {
  if (await prisma.dataPatch.findUnique({ where: { name: PATCH_22 } })) return [];
  const log: string[] = [];
  const projects = Object.fromEntries((await prisma.project.findMany()).map((p) => [p.code, p]));
  if (!projects.ADW || !projects.EVANTAMA || !projects.CCSI) return ['Patch 2.2 ditunda: project contoh belum ada'];
  const byName = async (projectId: string, names: string[]) => {
    const cs = await prisma.cluster.findMany({ where: { projectId, name: { in: names } } });
    return names.map((n) => cs.find((c) => c.name === n));
  };
  const [kal, kar] = await byName(projects.CCSI.id, [MANADO.kal, MANADO.kar]);
  const [semarang] = await byName(projects.CCSI.id, [SEMARANG]);
  const pemalang = await byName(projects.ADW.id, PEMALANG);
  const sinagar = await prisma.cluster.findFirst({ where: { projectId: projects.EVANTAMA.id, name: 'Cluster Sinagar Tasik' } });
  const ngawi = await prisma.cluster.findMany({ where: { projectId: projects.ADW.id, name: { contains: 'TEPAS' } }, orderBy: { sortOrder: 'asc' } });
  if (!kal || !kar || !semarang || pemalang.some((c) => !c) || !sinagar || ngawi.length !== 5) {
    return ['Patch 2.2 ditunda: cluster contoh belum lengkap'];
  }

  await prisma.$transaction(
    async (tx) => {
      // 1) tanggal implementasi dari info cluster (hanya yang masih kosong)
      for (const c of await tx.cluster.findMany({ where: { implementationDate: null } })) {
        const d = parseImplementationDate(c.info);
        if (!d) continue;
        await tx.cluster.update({ where: { id: c.id }, data: { implementationDate: new Date(`${d}T00:00:00Z`) } });
        await audit.diff(tx, userId, 'Cluster', c.id, { implementationDate: null }, { implementationDate: d, alasan: 'diambil dari info cluster' });
      }
      log.push('tanggal implementasi cluster diisi dari info');

      // 2) budget permit CCSI Manado: nilaiPoPermit dari sheet, permitCost = alokasi realisasi permit 22.000.000
      const pcts = manadoPermitPcts(kal.id, kar.id);
      const lines = allocate(PERMIT_REALISASI, pcts.map((p) => ({ clusterId: p.clusterId, manualPct: p.pct })), 'MANUAL');
      for (const [c, po] of [[kal, PERMIT_PO.kal], [kar, PERMIT_PO.kar]] as const) {
        if (!c.nilaiPoPermit.isZero() || !c.permitCost.isZero()) {
          log.push(`budget permit ${c.name} sudah terisi — tidak diubah`);
          continue;
        }
        const cost = lines.find((l) => l.clusterId === c.id)!.amount;
        // Fase 2.3: nilai permit = PO PERMIT (nilai cluster diturunkan dari tabel PO)
        await ensureClusterPos(tx, c.id);
        const permitPo = await tx.clusterPo.upsert({
          where: { sourceRef: poRef(c.id, 'PERMIT') },
          create: { clusterId: c.id, kind: 'PERMIT', amount: money(po), passThroughCost: money(cost), sourceRef: poRef(c.id, 'PERMIT'), note: REASON_PERMIT },
          update: { amount: money(po), passThroughCost: money(cost), note: REASON_PERMIT },
        });
        await syncDerivedFromPos(tx, c.id);
        await audit.diff(
          tx,
          userId,
          'Cluster',
          c.id,
          { nilaiPoPermit: c.nilaiPoPermit.toString(), permitCost: c.permitCost.toString(), alasan: null },
          { nilaiPoPermit: po, permitCost: cost.toFixed(2), alasan: REASON_PERMIT },
        );
        log.push(`${c.name}: nilaiPoPermit ${po}, permitCost ${cost.toFixed(2)}`);

        // 3) termin klien permit (manual, CCSI belum punya template): 1 termin 100%, sudah ditagih & belum dibayar
        const invoiceNo = c.id === kal.id ? PERMIT_INVOICE.kal : PERMIT_INVOICE.kar;
        const exists = await tx.clientPayment.findUnique({ where: { poId_termin: { poId: permitPo.id, termin: 1 } } });
        if (!exists) {
          const p = await tx.clientPayment.create({
            data: { ...(await terminTaxDefaults(tx, c.id)), clusterId: c.id, poId: permitPo.id, fromTemplate: false, kind: 'PERMIT', termin: 1, pct: '1', amount: money(po), invoiceNo, status: 'INVOICED', keterangan: 'Permit 100% (sheet CCSI: Unpaid)' },
          });
          await audit.diff(tx, userId, 'ClientPayment', p.id, null, { kind: 'PERMIT', termin: '1', amount: po, invoiceNo, status: 'INVOICED', alasan: REASON_PERMIT });
        }
      }

      // 4) SND Kalawiran: PO terpisah → daftar ditahan (pendapatan, bukan biaya)
      const sndRef = 'MANUAL:CCSI!F32';
      if (!(await tx.importHeldItem.findUnique({ where: { sourceRef: sndRef } }))) {
        const h = await tx.importHeldItem.create({
          data: {
            sourceRef: sndRef,
            projectId: projects.CCSI.id,
            sheet: 'CCSI',
            cell: 'F32',
            section: 'PO',
            blockTitle: 'CCSI - Site Manado',
            label: 'SND Kalawiran — INV-RAA/003/IX/2026 (PO SND FTTHSWI-5-280926, sheet E6)',
            amount: money('4373496'),
            kind: 'REVENUE',
            note: 'PO SND terpisah, belum masuk budget',
          },
        });
        await audit.diff(tx, userId, 'ImportHeldItem', h.id, null, { sourceRef: sndRef, amount: '4373496', kind: 'REVENUE', status: 'HELD' });
      }

      // 5) aturan pemetaan import (menimpa default 2.1 — keputusan eksplisit review)
      const rules: [string, string, RabDecision][] = [
        ['RAB:ADW!C79', projects.ADW.id, { scope: 'DUPLICATE', note: '≈ 5 sel Material Ngawi 20.814.181,21 = 18.386.500 + Tmbhn 2.425.000; selisih 2.681,21' }],
        ['RAB:ADW!C81', projects.ADW.id, { scope: 'PROJECT', method: 'PRO_RATA_PO', clusterIds: pemalang.map((c) => c!.id), category: 'SUBCON_MATERIAL', note: 'Dasar: buku kas mencatat "Mangunsari Pemalang"' }],
        ['RAB:CCSI!D36', projects.CCSI.id, { scope: 'PROJECT', method: 'PRO_RATA_PO', clusterIds: [kal.id, kar.id], category: 'PJD' }],
        ['RAB:CCSI!D31', projects.CCSI.id, { scope: 'PROJECT', method: 'MANUAL', clusterIds: [kal.id, kar.id], manualPcts: pcts, category: 'PERMIT', note: 'Pro-rata nilai permit 10.212.800 : 12.176.000' }],
        ['RAB:EVANTAMA:PJD:', projects.EVANTAMA.id, { scope: 'CLUSTER', clusterId: sinagar.id }],
        ['RAB:ADW!C69', projects.ADW.id, { scope: 'PROJECT', method: 'PRO_RATA_PO', clusterIds: ngawi.map((c) => c.id), category: 'PJD' }],
        ...(['C67', 'C68', 'C70'].map((cell) => [
          `RAB:ADW!${cell}`,
          projects.ADW.id,
          { scope: 'PROJECT', method: 'PRO_RATA_PO', clusterIds: [], clusterFilter: 'IMPL_DATE_LE_EXPENSE', category: 'PJD' },
        ]) as [string, string, RabDecision][]),
        ['RAB:CCSI:BLOCK:CCSI - Site Semarang', projects.CCSI.id, { scope: 'CLUSTER', clusterId: semarang.id }],
        ['RAB:CCSI!J36', projects.CCSI.id, { scope: 'INHERIT', category: 'PJD' }],
        ['RAB:CCSI!J31', projects.CCSI.id, { scope: 'HOLD', note: 'pendapatan permit Semarang belum tercatat — cek apakah pass-through' }],
      ];
      for (const [key, projectId, d] of rules) await saveRule(tx, audit, key, projectId, d, userId);
      log.push(`${rules.length} aturan import diperbarui`);

      await tx.dataPatch.create({ data: { name: PATCH_22, note: log.join('; ') } });
    },
    { timeout: 60_000 },
  );
  return log;
}
