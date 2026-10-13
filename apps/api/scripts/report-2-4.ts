/* Laporan Fase 2.4 (READ-ONLY — tidak mengubah data):
 *  - referensi tagihan RAB yang cocok otomatis per project (usulan; penerapan tetap dikonfirmasi FINANCE)
 *  - simulasi profit realisasi & PPN titipan bila semua yang cocok diterapkan
 *  - preview diff generate ulang termin (koreksi addwork/deduction ke termin 1)
 *  - Rekap: proyeksi, realisasi, margin permit, PPN titipan per project; notifikasi; item ditahan
 * Pemakaian: npx ts-node --transpile-only scripts/report-2-4.ts
 */
import { PrismaClient } from '@prisma/client';
import { calcCluster, calcProjectTotal, calcRealizedProfit, dec, formatAngka, moneyStr, paymentDeduction, sum } from '@indotek/shared';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { clusterCalcInput } from '../src/budget/budget.mapper';
import { paymentTax, recalcCluster, referenceMatches } from '../src/realization/client-payments.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const f = (v: { toString(): string }) => formatAngka(moneyStr(v.toString()));

async function main() {
  const prisma = new PrismaClient();
  const ps = prisma as unknown as PrismaService;
  const audit = new AuditService(ps);
  const settings = new SettingsService(ps, audit);
  const projects = await prisma.project.findMany({ orderBy: { code: 'asc' } });
  const g = await settings.effective(null, ps);
  const rekap: string[] = [];
  const sim: string[] = [];

  console.log('=== Referensi tagihan RAB — pencocokan otomatis (net = DPP + PPN − PPh ± Rp 10)');
  console.log('| Project | Referensi | Sudah diterapkan | Cocok (usulan) | Ganda | Tidak cocok |');
  for (const p of projects) {
    const { refs, matches } = await referenceMatches(prisma, p.id);
    const open = refs.filter((r) => !r.appliedPaymentId);
    const ok = open.filter((r) => matches.get(r.id)?.suggestion);
    const amb = open.filter((r) => matches.get(r.id)?.ambiguous);
    console.log(`| ${p.code} | ${refs.length} | ${refs.length - open.length} | ${ok.length} | ${amb.length} | ${open.length - ok.length - amb.length} |`);
    for (const r of refs) {
      const m = matches.get(r.id)?.suggestion;
      console.log(`     ${(r.termin ? `Term ${r.termin} ` : '').padEnd(7)}${r.invoiceNo.padEnd(22)} net ${f(r.netAmount ?? 0).padStart(12)} ${r.paid ? 'Paid  ' : 'Unpaid'} ${r.blockTitle ?? '-'} → ${m ? `COCOK ${m.clusterName} ${m.kind} termin ${m.termin} (net diharapkan ${f(m.expectedNet)})` : matches.get(r.id)?.ambiguous ? 'GANDA' : 'tidak cocok'}`);
    }

    // proyeksi & realisasi (kondisi sekarang) + simulasi setelah semua yang cocok diterapkan
    const setting = await settings.effective(p.id, ps);
    const clusters = await prisma.cluster.findMany({ where: { projectId: p.id }, include: { budgetLines: true } });
    const proj = calcProjectTotal(clusters.map((c) => calcCluster(clusterCalcInput(c, setting))));
    const payments = await prisma.clientPayment.findMany({ where: { cluster: { projectId: p.id } } });
    const biaya = (await prisma.expense.aggregate({ where: { projectId: p.id, status: 'TERVERIFIKASI' }, _sum: { amount: true } }))._sum.amount?.toString() ?? '0';
    const now = calcRealizedProfit(payments.map((x) => ({ status: x.status, amount: x.amount.toString(), paidAmount: x.paidAmount?.toString() ?? null, ppnRate: x.ppnRate.toString() })), biaya);
    const byId = new Map(payments.map((x) => [x.id, x]));
    let extraPajak = dec(0);
    const simPayments = payments.map((x) => ({ status: x.status as string, amount: x.amount.toString(), paidAmount: x.paidAmount?.toString() ?? null, ppnRate: x.ppnRate.toString() }));
    for (const r of ok) {
      const pay = byId.get(matches.get(r.id)!.suggestion!.paymentId)!;
      if (!r.paid || !r.netAmount) continue;
      const i = payments.indexOf(pay);
      simPayments[i] = { ...simPayments[i], status: 'PAID', paidAmount: r.netAmount.toString() };
      extraPajak = extraPajak.plus(paymentDeduction(paymentTax(pay).invoiceTotal, r.netAmount.toString()));
    }
    const after = calcRealizedProfit(simPayments, dec(biaya).plus(extraPajak));
    rekap.push(`| ${p.code} | ${f(proj.nilaiProyek)} | ${f(proj.profit)} | ${f(now.pembayaranBruto)} | ${f(now.realisasiBiaya)} | ${f(now.profitRealisasi)} | ${f(proj.marginPermit)} | ${f(now.ppnTitipan)} |`);
    sim.push(`| ${p.code} | ${ok.filter((r) => r.paid).length} | ${f(after.pembayaranBruto)} | ${f(extraPajak)} | ${f(after.realisasiBiaya)} | ${f(after.profitRealisasi)} | ${f(after.ppnTitipan)} | ${f(after.kasDiterima)} |`);
  }

  console.log(`\n=== Rekap sekarang (retensiAsCost=${g.retensiAsCost}, interest ${g.interestRate}, PPN ${g.ppnRate})`);
  console.log('| Project | Nilai proyek | Profit proyeksi | DPP termin PAID | Realisasi biaya | Profit realisasi | Margin permit | PPN titipan |');
  for (const r of rekap) console.log(r);
  console.log('\n=== Simulasi: semua referensi yang cocok diterapkan (BELUM diterapkan — menunggu konfirmasi FINANCE)');
  console.log('| Project | Ref Paid diterapkan | DPP termin PAID | + PAJAK otomatis | Realisasi biaya | Profit realisasi | PPN titipan | Kas diterima |');
  for (const r of sim) console.log(r);

  console.log('\n=== Margin permit per cluster (hanya PO PERMIT)');
  for (const c of await prisma.cluster.findMany({ where: { OR: [{ permitPoAmount: { not: 0 } }, { permitCost: { not: 0 } }] }, include: { budgetLines: true, project: true } })) {
    const s = await settings.effective(c.projectId, ps);
    const r = calcCluster(clusterCalcInput(c, s));
    console.log(`   ${c.project.code} ${c.name}: PO permit ${f(c.permitPoAmount)} (nilaiPoPermit ${f(c.nilaiPoPermit)}), biaya ${f(c.permitCost)} → margin ${f(r.marginPermit)}`);
  }

  console.log('\n=== Preview generate ulang termin (koreksi addwork/deduction ke termin 1) — BELUM diterapkan');
  const adjClusters = await prisma.cluster.findMany({ where: { pos: { some: { kind: { in: ['ADDWORK', 'DEDUCTION'] } } } }, orderBy: { sortOrder: 'asc' } });
  for (const c of adjClusters) {
    const res = await recalcCluster(prisma, audit, null, c.id, false);
    console.log(`-- ${c.name}`);
    for (const k of res.kinds.filter((x) => x.diffs.some((d) => d.changed))) {
      console.log(`   PO ${k.kind}${k.poNumber ? ` ${k.poNumber}` : ''}: dasar ${f(k.base)}${Number(k.adjustment) ? `, koreksi ${f(k.adjustment)}` : ''}, target ${f(k.target)}${k.error ? `  ERROR: ${k.error}` : ''}${k.warning ? `  PERINGATAN: ${k.warning}` : ''}`);
      for (const d of k.diffs) {
        console.log(`      termin ${d.termin} [${d.deleted ? 'HAPUS' : d.status}] ${d.oldAmount ? f(d.oldAmount) : '—'} → ${d.deleted ? '(dihapus)' : f(d.newAmount)}${d.changed && !d.deleted ? '  *' : ''}`);
      }
    }
  }

  const notif = await prisma.notification.groupBy({ by: ['type'], _count: true });
  console.log(`\n=== Notifikasi: ${notif.map((n) => `${n.type} ${n._count}`).join(', ')}`);
  for (const n of await prisma.notification.findMany({ distinct: ['key'], orderBy: { createdAt: 'asc' } })) console.log(`   [${n.type}] ${n.title}\n${n.body.split('\n').map((l) => `      ${l}`).join('\n')}`);
  console.log(`\n=== Item ditahan: ${await prisma.importHeldItem.count({ where: { status: 'HELD' } })}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
