import type { ClusterPo, PrismaClient } from '@prisma/client';
import { generateTermins, sum } from '@indotek/shared';
import { money, rate } from '../common/decimal';
import type { Tx } from '../prisma/prisma.service';
import { ensureClusterPos } from '../clusters/po-support';

type Db = PrismaClient | Tx;

/** Jenis PO yang termin-nya mengikuti template client. */
export const TEMPLATE_PO_KINDS = ['IMPLEMENTASI', 'PERMIT'] as const;
/** Jenis PO yang mengoreksi termin 1 PO implementasi (tidak punya termin sendiri). */
export const ADJUSTMENT_PO_KINDS = ['ADDWORK', 'DEDUCTION'] as const;

/**
 * Tarif default termin baru. PPN: Setting project → Client.ppnRate → Setting global → 0,11.
 * PPh = pajakRate cluster.
 */
export async function terminTaxDefaults(db: Db, clusterId: string) {
  const c = await db.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: { include: { client: true } } } });
  const [own, global] = await Promise.all([
    db.setting.findUnique({ where: { projectId: c.projectId } }),
    db.setting.findFirst({ where: { projectId: null } }),
  ]);
  return { ppnRate: rate((own?.ppnRate ?? c.project.client.ppnRate ?? global?.ppnRate ?? '0.11').toString()), pphRate: c.pajakRate };
}

/** PO implementasi utama (yang pertama dibuat) — penerima koreksi addwork/deduction. */
export function primaryImplPo<T extends Pick<ClusterPo, 'kind' | 'createdAt'>>(pos: T[]): T | undefined {
  return [...pos].filter((p) => p.kind === 'IMPLEMENTASI').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
}

/** Σ PO ADDWORK + DEDUCTION cluster (koreksi termin 1). */
export function adjustmentSum(pos: Pick<ClusterPo, 'kind' | 'amount'>[]) {
  return sum(pos.filter((p) => (ADJUSTMENT_PO_KINDS as readonly string[]).includes(p.kind)).map((p) => p.amount.toString()));
}

/**
 * Generate termin pembayaran klien per PO (insert-only, aman dipanggil ulang):
 *  - IMPLEMENTASI / PERMIT → template client (bila ada; CCSI belum punya template → tidak ada termin otomatis).
 *    Termin 1 PO implementasi utama = template% × PO dasar + Σ addwork/deduction (Fase 2.4).
 *  - ADDWORK / DEDUCTION → tidak punya termin sendiri (mengoreksi termin 1 implementasi).
 *  - SND → 1 termin 100% manual (fromTemplate = false, tanggal invoice perlu dilengkapi).
 * PO bernilai 0 dilewati. Tarif PPN/PPh default diisi saat termin dibuat.
 */
export async function generateClientPayments(db: Db, clusterId: string, onlyPoId?: string) {
  await ensureClusterPos(db, clusterId);
  const cluster = await db.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
  const templates = await db.terminTemplate.findMany({ where: { clientId: cluster.project.clientId }, include: { lines: true } });
  const all = await db.clusterPo.findMany({ where: { clusterId }, orderBy: { createdAt: 'asc' } });
  const primary = primaryImplPo(all);
  const adj = adjustmentSum(all);
  const tax = await terminTaxDefaults(db, clusterId);
  let created = 0;
  for (const po of all.filter((p) => !onlyPoId || p.id === onlyPoId)) {
    if (po.amount.isZero() || (ADJUSTMENT_PO_KINDS as readonly string[]).includes(po.kind)) continue;
    const isTemplateKind = (TEMPLATE_PO_KINDS as readonly string[]).includes(po.kind);
    const tpl = isTemplateKind ? templates.find((t) => t.kind === po.kind) : undefined;
    if (isTemplateKind && !tpl?.lines.length) continue;
    const retention = new Map((tpl?.lines ?? []).map((l) => [l.terminKe, l.retentionMonths ?? null]));
    const lines = tpl
      ? tpl.lines.map((l) => ({ terminKe: l.terminKe, pct: l.pct.toString(), keterangan: l.keterangan }))
      : [{ terminKe: 1, pct: '1', keterangan: 'SND 100%' }];
    const rows = generateTermins(lines, po.amount.toString());
    if (primary?.id === po.id && !adj.isZero() && rows.length) rows[0].amount = rows[0].amount.plus(adj);
    for (const r of rows) {
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
          retentionMonths: retention.get(r.terminKe) ?? null,
          ...tax,
        },
      });
      created++;
    }
  }
  return created;
}
