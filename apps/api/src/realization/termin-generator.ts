import type { ClusterPo, PrismaClient } from '@prisma/client';
import { generateTermins } from '@indotek/shared';
import { money, rate } from '../common/decimal';
import type { Tx } from '../prisma/prisma.service';
import { ensureClusterPos } from '../clusters/po-support';

type Db = PrismaClient | Tx;

/** Jenis PO yang termin-nya mengikuti template client; jenis lain = termin manual 1 × 100%. */
export const TEMPLATE_PO_KINDS = ['IMPLEMENTASI', 'PERMIT'] as const;

/**
 * Generate termin pembayaran klien per PO (insert-only, aman dipanggil ulang):
 *  - IMPLEMENTASI / PERMIT → template client (bila ada; CCSI belum punya template → tidak ada termin otomatis).
 *  - SND / ADDWORK / DEDUCTION → 1 termin 100% manual (fromTemplate = false, tanggal invoice perlu dilengkapi).
 * PO bernilai 0 dilewati.
 */
export async function generateClientPayments(db: Db, clusterId: string, onlyPoId?: string) {
  await ensureClusterPos(db, clusterId);
  const cluster = await db.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
  const templates = await db.terminTemplate.findMany({ where: { clientId: cluster.project.clientId }, include: { lines: true } });
  const pos = await db.clusterPo.findMany({ where: { clusterId, ...(onlyPoId ? { id: onlyPoId } : {}) }, orderBy: { createdAt: 'asc' } });
  let created = 0;
  for (const po of pos) created += await generateForPo(db, po, templates);
  return created;
}

async function generateForPo(
  db: Db,
  po: ClusterPo,
  templates: { kind: string; lines: { terminKe: number; pct: { toString(): string }; keterangan: string | null }[] }[],
) {
  if (po.amount.isZero()) return 0;
  const isTemplateKind = (TEMPLATE_PO_KINDS as readonly string[]).includes(po.kind);
  const tpl = isTemplateKind ? templates.find((t) => t.kind === po.kind) : undefined;
  if (isTemplateKind && !tpl?.lines.length) return 0;
  const lines = tpl
    ? tpl.lines.map((l) => ({ terminKe: l.terminKe, pct: l.pct.toString(), keterangan: l.keterangan }))
    : [{ terminKe: 1, pct: '1', keterangan: `${po.kind === 'SND' ? 'SND' : po.kind === 'ADDWORK' ? 'Addwork' : 'Deduction'} 100%` }];
  let created = 0;
  for (const r of generateTermins(lines, po.amount.toString())) {
    const exists = await db.clientPayment.findUnique({ where: { poId_termin: { poId: po.id, termin: r.terminKe } } });
    if (exists) continue;
    await db.clientPayment.create({
      data: {
        clusterId: po.clusterId,
        poId: po.id,
        fromTemplate: !!tpl,
        kind: po.kind,
        termin: r.terminKe,
        pct: rate(r.pct),
        amount: money(r.amount),
        keterangan: r.keterangan,
      },
    });
    created++;
  }
  return created;
}
