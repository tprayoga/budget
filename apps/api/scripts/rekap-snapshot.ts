/* Snapshot Rekap (READ-ONLY) dalam JSON deterministik + hash SHA-256 — pembanding uji backup/restore & migrasi.
 * Isi per project: nilai proyek, profit proyeksi, margin permit, DPP termin dibayar, realisasi biaya, profit realisasi,
 * PPN titipan, piutang ditagih (DPP + PPN termin INVOICED), jumlah cluster/termin/expense.
 * Pemakaian: node dist-scripts/scripts/rekap-snapshot.js [--json]   (hash di baris terakhir)
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { calcCluster, calcProjectTotal, calcRealizedProfit, dec, moneyStr, sum, terminTax } from '@indotek/shared';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { clusterCalcInput } from '../src/budget/budget.mapper';
import type { PrismaService } from '../src/prisma/prisma.service';

export async function rekapSnapshot(prisma: PrismaClient) {
  const ps = prisma as unknown as PrismaService;
  const settings = new SettingsService(ps, new AuditService(ps));
  const projects = await prisma.project.findMany({ orderBy: { code: 'asc' } });
  const out: Record<string, Record<string, string | number>> = {};
  for (const p of projects) {
    const setting = await settings.effective(p.id, ps);
    const clusters = await prisma.cluster.findMany({ where: { projectId: p.id }, include: { budgetLines: true }, orderBy: { name: 'asc' } });
    const proj = calcProjectTotal(clusters.map((c) => calcCluster(clusterCalcInput(c, setting))));
    const payments = await prisma.clientPayment.findMany({ where: { cluster: { projectId: p.id } } });
    const biaya = (await prisma.expense.aggregate({ where: { projectId: p.id, status: 'TERVERIFIKASI' }, _sum: { amount: true } }))._sum.amount?.toString() ?? '0';
    const real = calcRealizedProfit(payments.map((x) => ({ status: x.status, amount: x.amount.toString(), paidAmount: x.paidAmount?.toString() ?? null, ppnRate: x.ppnRate.toString() })), biaya);
    const tax = (x: (typeof payments)[number]) => terminTax({ amount: x.amount.toString(), ppnRate: x.ppnRate.toString(), pphRate: x.pphRate.toString() });
    const invoiced = payments.filter((x) => x.status === 'INVOICED');
    out[p.code] = {
      nilaiProyek: moneyStr(proj.nilaiProyek),
      profitProyeksi: moneyStr(proj.profit),
      marginPermit: moneyStr(proj.marginPermit),
      dppTerminDibayar: moneyStr(real.pembayaranBruto),
      realisasiBiaya: moneyStr(real.realisasiBiaya),
      profitRealisasi: moneyStr(real.profitRealisasi),
      ppnTitipan: moneyStr(real.ppnTitipan),
      piutangDitagih: moneyStr(sum(invoiced.map((x) => tax(x).invoiceTotal))),
      piutangNetDiharapkan: moneyStr(sum(invoiced.map((x) => tax(x).expectedNet))),
      cluster: clusters.length,
      termin: payments.length,
      terminDibayar: payments.filter((x) => x.status === 'PAID').length,
      expenseTerverifikasi: await prisma.expense.count({ where: { projectId: p.id, status: 'TERVERIFIKASI' } }),
      retensiAsCost: String(setting.retensiAsCost),
      interestRate: dec(setting.interestRate).toString(),
    };
  }
  const json = JSON.stringify(out, null, 2);
  return { data: out, json, sha256: createHash('sha256').update(json).digest('hex') };
}

async function main() {
  const prisma = new PrismaClient();
  const r = await rekapSnapshot(prisma);
  console.log(r.json);
  console.log(`REKAP_SHA256=${r.sha256}`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
