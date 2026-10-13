/* Import realisasi dari file RAB memakai aturan pemetaan default, lalu cetak laporan per project.
 * Pemakaian: npx ts-node --transpile-only scripts/import-rab.ts <file.xlsx> [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { calcCluster, dec, frBudgetAmounts, moneyStr, sum, formatAngka, formatPersen, type D } from '@indotek/shared';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { ExpenseSupportService } from '../src/realization/expense-support.service';
import { RabImporter } from '../src/import/rab-importer';
import { seedDefaultRabRules } from '../src/import/default-rab-rules';
import { clusterCalcInput } from '../src/budget/budget.mapper';
import type { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!file) throw new Error('Pemakaian: scripts/import-rab.ts <file.xlsx> [--dry-run]');
  const prisma = new PrismaClient();
  const ps = prisma as unknown as PrismaService;
  const audit = new AuditService(ps);
  const settings = new SettingsService(ps, audit);
  const importer = new RabImporter(prisma, audit, new ExpenseSupportService(ps));
  const admin = await prisma.user.findFirst({ where: { role: { in: ['FINANCE', 'ADMIN'] } }, orderBy: [{ role: 'desc' }, { createdAt: 'asc' }] });
  await seedDefaultRabRules(prisma, admin?.id ?? null);

  const parsed = await importer.parse(await readFile(file));
  const result = dryRun ? { created: 0, updated: 0, held: 0, preview: await importer.preview(parsed) } : await importer.commit(parsed, {}, admin?.id ?? null);
  console.log(`${dryRun ? 'DRY-RUN' : 'COMMIT'}: dibuat ${result.created}, diperbarui ${result.updated}, ditahan ${result.held}`);

  for (const sheet of result.preview.sheets) {
    if (!sheet.projectId) continue;
    const items = result.preview.items.filter((i) => i.projectId === sheet.projectId);
    const count = (st: string) => items.filter((i) => i.status === st).length;
    const amt = (st: string) => moneyStr(sum(items.filter((i) => i.status === st).map((i) => i.amount)));
    const imported = items.filter((i) => ['NEW', 'CHANGED', 'UNCHANGED'].includes(i.status));
    const realisasi = await prisma.expense.aggregate({ where: { projectId: sheet.projectId, status: 'TERVERIFIKASI' }, _sum: { amount: true } });
    const realisasiImport = await prisma.expense.aggregate({ where: { projectId: sheet.projectId, status: 'TERVERIFIKASI', source: 'IMPORT_RAB' }, _sum: { amount: true } });

    // % terpakai per cluster = Σ alokasi terverifikasi / total budget pos (kalkulasi budget cluster)
    const setting = await settings.effective(sheet.projectId, ps);
    const clusters = await prisma.cluster.findMany({ where: { projectId: sheet.projectId }, include: { budgetLines: true } });
    const rows: { name: string; budget: D; realisasi: D; pct: D }[] = [];
    for (const c of clusters) {
      const budget = sum(Object.values(frBudgetAmounts(calcCluster(clusterCalcInput(c, setting)))));
      const real = await prisma.expenseAllocation.aggregate({ where: { clusterId: c.id, expense: { status: 'TERVERIFIKASI' } }, _sum: { amount: true } });
      const r = dec(real._sum.amount?.toString() ?? '0');
      rows.push({ name: c.name, budget, realisasi: r, pct: budget.isZero() ? dec(0) : r.div(budget) });
    }
    rows.sort((a, b) => b.pct.comparedTo(a.pct));

    console.log(`\n=== ${sheet.projectCode}`);
    console.log(`Total realisasi terverifikasi : Rp ${formatAngka(realisasi._sum.amount?.toString() ?? '0')} (dari import RAB: Rp ${formatAngka(realisasiImport._sum.amount?.toString() ?? '0')})`);
    console.log(`Item terimpor                 : ${imported.length} (Rp ${formatAngka(moneyStr(sum(imported.map((i) => i.amount))))})`);
    console.log(`Dilewati                      : ${count('SKIPPED')} (Rp ${formatAngka(amt('SKIPPED'))})`);
    console.log(`Ditahan                       : ${count('HELD')} (Rp ${formatAngka(amt('HELD'))})`);
    console.log(`Duplikat                      : ${count('DUPLICATE')} (Rp ${formatAngka(amt('DUPLICATE'))})`);
    console.log(`Masih perlu dipetakan         : ${count('NEEDS_MAPPING')} (Rp ${formatAngka(amt('NEEDS_MAPPING'))})`);
    for (const i of items.filter((x) => ['HELD', 'DUPLICATE', 'NEEDS_MAPPING', 'SKIPPED'].includes(x.status))) {
      console.log(`   - ${i.status.padEnd(13)} ${i.sheet}!${i.cell} ${i.label.slice(0, 48)} Rp ${formatAngka(i.amount)}${i.note ? ` — ${i.note.slice(0, 70)}` : ''}`);
    }
    console.log('5 cluster dengan % terpakai tertinggi:');
    for (const r of rows.slice(0, 5)) console.log(`   ${formatPersen(r.pct.toString(), 1).padStart(7)}  ${r.name}  (Rp ${formatAngka(r.realisasi.toString())} / ${formatAngka(r.budget.toString())})`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
