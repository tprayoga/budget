/* Terapkan keputusan Fase 2.4 yang sudah disetujui user (14 Okt 2026), idempotent:
 *  (a) generate ulang termin 6 cluster ADW: koreksi addwork/deduction ke termin 1, termin terpisah dihapus
 *  (b) terapkan referensi EVANTAMA yang cocok (mode NET); referensi Paid tanpa tanggal → tanggal diterima kosong (badge)
 * Pelaku audit = sistem. Pemakaian: npx ts-node --transpile-only scripts/apply-2-4-decisions.ts
 */
import { PrismaClient } from '@prisma/client';
import { formatAngka, moneyStr } from '@indotek/shared';
import { AuditService } from '../src/audit/audit.service';
import { AccessService } from '../src/access/access.service';
import { ExpenseSupportService } from '../src/realization/expense-support.service';
import { ClientPaymentsService, recalcCluster, referenceMatches } from '../src/realization/client-payments.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuthUser } from '../src/auth/auth.types';

async function main() {
  const prisma = new PrismaClient();
  const ps = prisma as unknown as PrismaService;
  const audit = new AuditService(ps);
  const f = (v: { toString(): string }) => formatAngka(moneyStr(v.toString()));

  console.log('=== (a) Generate ulang termin ADW (koreksi addwork/deduction ke termin 1)');
  const adj = await prisma.cluster.findMany({ where: { pos: { some: { kind: { in: ['ADDWORK', 'DEDUCTION'] } } } }, orderBy: { sortOrder: 'asc' } });
  for (const c of adj) {
    const res = await prisma.$transaction((tx) => recalcCluster(tx, audit, null, c.id, true), { timeout: 60_000 });
    const err = res.kinds.find((k) => k.error);
    if (err) throw new Error(`${c.name}: ${err.error}`);
    const changed = res.kinds.flatMap((k) => k.diffs.filter((d) => d.changed).map((d) => `${k.kind} t${d.termin} ${d.deleted ? `${f(d.oldAmount!)} dihapus` : `${d.oldAmount ? f(d.oldAmount) : '—'} → ${f(d.newAmount)}`}`));
    console.log(`   ${c.name}: ${changed.length ? changed.join('; ') : 'sudah sesuai'}`);
  }

  console.log('\n=== (b) Terapkan referensi EVANTAMA yang cocok');
  const ev = await prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' } });
  const svc = new ClientPaymentsService(ps, audit, new AccessService(ps), new ExpenseSupportService(ps));
  const system = { id: null, role: 'ADMIN', name: 'sistem', email: 'sistem' } as unknown as AuthUser;
  const { refs, matches } = await referenceMatches(prisma, ev.id);
  const clusters = new Set(refs.filter((r) => !r.appliedPaymentId && matches.get(r.id)?.suggestion?.mode === 'NET').map((r) => matches.get(r.id)!.suggestion!.clusterId));
  for (const cid of clusters) {
    const res = await svc.applyMatched(system, cid, { paidDate: null });
    for (const a of res.applied) console.log(`   ${a.invoiceNo} → ${a.kind} termin ${a.termin}`);
  }
  const after = await referenceMatches(prisma, ev.id);
  console.log(`   Referensi EVANTAMA: ${after.refs.filter((r) => r.appliedPaymentId).length} diterapkan, ${after.refs.filter((r) => !r.appliedPaymentId).length} terbuka`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
