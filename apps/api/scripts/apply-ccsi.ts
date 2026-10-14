/* Keputusan CCSI 14 Okt 2026 + aturan pencocokan C.
 *   default        : DRY-RUN A+B (rencana PPN 0 & termin implementasi CCSI) + laporan pencocokan (tanpa menulis)
 *   --commit       : terapkan A+B, lalu terapkan referensi CCSI yang cocok (aturan C) sebagai INVOICED/PAID
 * EVANTAMA hanya dilaporkan (aturan C: perubahan dibanding aturan lama).
 */
import { PrismaClient } from '@prisma/client';
import { dec, formatAngka, matchReferenceToTermin, moneyStr } from '@indotek/shared';
import { AuditService } from '../src/audit/audit.service';
import { AccessService } from '../src/access/access.service';
import { ExpenseSupportService } from '../src/realization/expense-support.service';
import { ClientPaymentsService, paymentTax, referenceMatches } from '../src/realization/client-payments.service';
import { applyCcsiDecisions } from '../src/import/patch-2-5-ccsi';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuthUser } from '../src/auth/auth.types';

async function report(prisma: PrismaClient, code: string) {
  const f = (v: { toString(): string }) => formatAngka(moneyStr(v.toString()));
  const project = await prisma.project.findUniqueOrThrow({ where: { code } });
  const { refs, matches, valueType } = await referenceMatches(prisma, project.id);
  const payments = await prisma.clientPayment.findMany({ where: { cluster: { projectId: project.id } }, include: { cluster: true } });
  console.log(`\n=== ${code}: ${refs.length} referensi`);
  for (const r of refs) {
    const m = matches.get(r.id);
    let line: string;
    if (r.appliedPaymentId) {
      const p = payments.find((x) => x.id === r.appliedPaymentId)!;
      const tax = paymentTax(p);
      const target = valueType === 'NET' ? tax.expectedNet : tax.invoiceTotal;
      const ok = dec(r.netAmount?.toString() ?? 0).minus(target).abs().lte(10);
      line = `SUDAH DITERAPKAN → ${p.cluster.name} ${p.kind} termin ${p.termin} [${p.status}] · ${valueType === 'NET' ? 'net' : 'tagihan'} ${f(target)} → ${ok ? 'cocok' : 'TIDAK cocok'}`;
    } else if (m?.suggestion) {
      line = `${m.suggestion.mode === 'DPP' ? 'COCOK DI DPP (perlu konfirmasi pajak)' : `COCOK (${m.suggestion.basis === 'INVOICE_TOTAL' ? 'tagihan DPP + PPN' : 'net DPP + PPN − PPh'})`} → ${m.suggestion.clusterName} ${m.suggestion.kind} termin ${m.suggestion.termin} (${f(m.suggestion.expectedNet)})`;
    } else {
      // petunjuk: apakah nilainya sama dengan net diharapkan suatu termin (pola aturan lama)?
      const cands = payments.filter((p) => !r.clusterId || p.clusterId === r.clusterId).map((p) => ({ id: p.id, termin: p.termin, expectedNet: paymentTax(p).expectedNet, p }));
      const old = matchReferenceToTermin({ netAmount: r.netAmount?.toString() ?? null, termin: r.termin }, cands).match;
      line = `tidak cocok${old ? ` (nilai = net diharapkan ${old.p.cluster.name} ${old.p.kind} termin ${old.termin}, padahal status ${r.paid ? 'Paid' : 'Unpaid'})` : ''}${m?.ambiguous ? ' (ganda)' : ''}`;
    }
    console.log(`   ${(r.termin ? `T${r.termin} ` : '').padEnd(4)}${r.invoiceNo.padEnd(20)} ${r.paid ? 'Paid  ' : 'Unpaid'} ${f(r.netAmount ?? 0).padStart(12)} ${r.blockTitle ?? ''} → ${line}`);
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const prisma = new PrismaClient();
  const ps = prisma as unknown as PrismaService;
  const audit = new AuditService(ps);
  console.log(`=== ${commit ? 'COMMIT' : 'DRY-RUN'} keputusan CCSI (A: PPN 0, B: template implementasi 30/30/30/10)`);
  const log = await applyCcsiDecisions(prisma, audit, null, commit);
  for (const l of log) console.log(`   ${l}`);
  if (!log.length) console.log('   (sudah diterapkan sebelumnya)');

  if (commit) {
    console.log('\n=== C: terapkan referensi CCSI yang cocok (aturan C)');
    const svc = new ClientPaymentsService(ps, audit, new AccessService(ps), new ExpenseSupportService(ps));
    const system = { id: null, role: 'ADMIN', name: 'sistem', email: 'sistem' } as unknown as AuthUser;
    const ccsi = await prisma.project.findUniqueOrThrow({ where: { code: 'CCSI' } });
    const { refs, matches } = await referenceMatches(prisma, ccsi.id);
    const clusterIds = new Set(refs.filter((r) => !r.appliedPaymentId && matches.get(r.id)?.suggestion?.mode === 'NET').map((r) => matches.get(r.id)!.suggestion!.clusterId));
    for (const cid of clusterIds) for (const a of (await svc.applyMatched(system, cid, { paidDate: null })).applied) console.log(`   ${a.invoiceNo} → ${a.kind} termin ${a.termin}`);
  }
  await report(prisma, 'CCSI');
  await report(prisma, 'EVANTAMA');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
