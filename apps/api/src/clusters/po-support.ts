import type { ClusterPo, PrismaClient } from '@prisma/client';
import { derivePoTotals, parsePoNumbers } from '@indotek/shared';
import type { Tx } from '../prisma/prisma.service';
import { money, s } from '../common/decimal';

type Db = PrismaClient | Tx;

/** Field cluster yang diturunkan dari tabel PO (tidak bisa diedit langsung). */
export const PO_DERIVED_FIELDS = ['nilaiPoImpl', 'nilaiPoPermit', 'permitCost'] as const;

export const poRef = (clusterId: string, kind: 'IMPLEMENTASI' | 'PERMIT') => `MIGRASI:${clusterId}:${kind}`;

export function poDto(p: ClusterPo) {
  return {
    id: p.id,
    clusterId: p.clusterId,
    kind: p.kind,
    poNumber: p.poNumber,
    poDate: p.poDate ? p.poDate.toISOString().slice(0, 10) : null,
    amount: s(p.amount)!,
    passThroughCost: s(p.passThroughCost)!,
    note: p.note,
    sourceRef: p.sourceRef,
  };
}

export function poFlat(p: ClusterPo | null) {
  if (!p) return null;
  const d = poDto(p);
  return { kind: d.kind, poNumber: d.poNumber, poDate: d.poDate, amount: d.amount, passThroughCost: d.passThroughCost, note: d.note };
}

/**
 * Buat PO dasar dari nilai lama cluster bila cluster belum punya PO:
 * 1 IMPLEMENTASI (nilaiPoImpl) + 1 PERMIT bila nilaiPoPermit/permitCost > 0 (passThroughCost = permitCost).
 * Nomor PO diambil dari teks info. Termin lama tanpa PO dikaitkan ke PO sesuai jenisnya.
 */
export async function ensureClusterPos(db: Db, clusterId: string): Promise<ClusterPo[]> {
  const existing = await db.clusterPo.findMany({ where: { clusterId }, orderBy: { createdAt: 'asc' } });
  if (existing.length) return existing;
  const c = await db.cluster.findUniqueOrThrow({ where: { id: clusterId } });
  const nums = parsePoNumbers(c.info);
  const created: ClusterPo[] = [
    await db.clusterPo.create({
      data: {
        clusterId,
        kind: 'IMPLEMENTASI',
        poNumber: nums.implementasi.join(' + ') || null,
        amount: c.nilaiPoImpl,
        sourceRef: poRef(clusterId, 'IMPLEMENTASI'),
        note: 'migrasi dari nilai PO cluster',
      },
    }),
  ];
  if (!c.nilaiPoPermit.isZero() || !c.permitCost.isZero()) {
    created.push(
      await db.clusterPo.create({
        data: {
          clusterId,
          kind: 'PERMIT',
          poNumber: nums.permit.join(' + ') || null,
          amount: c.nilaiPoPermit,
          passThroughCost: c.permitCost,
          sourceRef: poRef(clusterId, 'PERMIT'),
          note: 'migrasi dari nilai PO cluster',
        },
      }),
    );
  }
  await linkOrphanTermins(db, clusterId);
  return created;
}

/** Kaitkan termin lama (poId kosong) ke PO IMPLEMENTASI/PERMIT pertama cluster. */
export async function linkOrphanTermins(db: Db, clusterId: string) {
  const pos = await db.clusterPo.findMany({ where: { clusterId }, orderBy: { createdAt: 'asc' } });
  for (const kind of ['IMPLEMENTASI', 'PERMIT'] as const) {
    const po = pos.find((p) => p.kind === kind);
    if (po) await db.clientPayment.updateMany({ where: { clusterId, kind, poId: null }, data: { poId: po.id } });
  }
}

/** Hitung ulang nilai turunan cluster dari PO. Mengembalikan nilai sebelum & sesudah (untuk audit). */
export async function syncDerivedFromPos(db: Db, clusterId: string) {
  const c = await db.cluster.findUniqueOrThrow({ where: { id: clusterId } });
  const pos = await db.clusterPo.findMany({ where: { clusterId } });
  const t = derivePoTotals(pos.map((p) => ({ kind: p.kind, amount: p.amount.toString(), passThroughCost: p.passThroughCost.toString() })));
  const before = { nilaiPoImpl: s(c.nilaiPoImpl)!, nilaiPoPermit: s(c.nilaiPoPermit)!, permitCost: s(c.permitCost)! };
  const after = { nilaiPoImpl: t.nilaiPoImpl.toFixed(2), nilaiPoPermit: t.nilaiPoPermit.toFixed(2), permitCost: t.permitCost.toFixed(2) };
  if (before.nilaiPoImpl !== after.nilaiPoImpl || before.nilaiPoPermit !== after.nilaiPoPermit || before.permitCost !== after.permitCost) {
    await db.cluster.update({
      where: { id: clusterId },
      data: { nilaiPoImpl: money(after.nilaiPoImpl), nilaiPoPermit: money(after.nilaiPoPermit), permitCost: money(after.permitCost) },
    });
  }
  return { before, after };
}

/** Tandai field diedit di aplikasi → dilindungi dari import budget Excel. */
export async function markOverride(db: Db, entityId: string, fields: string[], userId: string | null, reason?: string | null) {
  for (const field of fields) {
    await db.fieldOverride.upsert({
      where: { entity_entityId_field: { entity: 'Cluster', entityId, field } },
      create: { entity: 'Cluster', entityId, field, userId, reason: reason ?? null },
      update: { userId, reason: reason ?? null, at: new Date() },
    });
  }
}
