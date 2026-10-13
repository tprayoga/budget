import type { PrismaClient } from '@prisma/client';
import { generateTermins } from '@indotek/shared';
import { money, rate } from '../common/decimal';
import type { Tx } from '../prisma/prisma.service';

/**
 * Generate termin pembayaran klien untuk satu cluster dari TerminTemplate client project-nya.
 * IMPLEMENTASI memakai nilaiPoImpl, PERMIT memakai nilaiPoPermit (dilewati bila 0).
 * Hanya membuat termin yang belum ada (insert-only), sehingga aman dipanggil ulang.
 * Dipakai saat cluster dibuat, seed backfill, dan endpoint generate.
 */
export async function generateClientPayments(db: PrismaClient | Tx, clusterId: string) {
  const cluster = await db.cluster.findUniqueOrThrow({ where: { id: clusterId }, include: { project: true } });
  const templates = await db.terminTemplate.findMany({
    where: { clientId: cluster.project.clientId },
    include: { lines: true },
  });
  let created = 0;
  for (const t of templates) {
    const base = t.kind === 'PERMIT' ? cluster.nilaiPoPermit : cluster.nilaiPoImpl;
    if (base.isZero() || !t.lines.length) continue;
    const rows = generateTermins(
      t.lines.map((l) => ({ terminKe: l.terminKe, pct: l.pct.toString(), keterangan: l.keterangan })),
      base.toString(),
    );
    for (const r of rows) {
      const exists = await db.clientPayment.findUnique({
        where: { clusterId_kind_termin: { clusterId, kind: t.kind, termin: r.terminKe } },
      });
      if (exists) continue;
      await db.clientPayment.create({
        data: {
          clusterId,
          kind: t.kind,
          termin: r.terminKe,
          pct: rate(r.pct),
          amount: money(r.amount),
          keterangan: r.keterangan,
        },
      });
      created++;
    }
  }
  return created;
}
