/* Laporan READ-ONLY: per cluster — budget total, realisasi tanpa pengajuan, sisa yang bisa diajukan (sama dengan wizard).
 * Pemakaian: npx ts-node --transpile-only scripts/report-sisa-pengajuan.ts [KODE_PROJECT ...]
 */
import { PrismaClient } from '@prisma/client';
import { aggregateFrHistory, calcCluster, computeFundRequest, D, formatAngka, frBudgetAmounts, frDefaultPcts, FR_CODES, moneyStr } from '@indotek/shared';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { clusterCalcInput } from '../src/budget/budget.mapper';
import { realisasiTanpaPengajuan } from '../src/fund-requests/realisasi-tanpa-pengajuan';
import type { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const codes = process.argv.slice(2).length ? process.argv.slice(2) : ['CCSI', 'EVANTAMA'];
  const prisma = new PrismaClient();
  const ps = prisma as unknown as PrismaService;
  const settings = new SettingsService(ps, new AuditService(ps));
  const f = (v: { toString(): string }) => formatAngka(moneyStr(v.toString()));
  console.log('| Project | Cluster | Budget cluster | Sudah dicairkan + proses | Realisasi tanpa pengajuan | Over di pos lain | Σ sisa pos | Sisa cluster | Default diajukan | Termin ke |');
  for (const code of codes) {
    const clusters = await prisma.cluster.findMany({ where: { project: { code } }, include: { budgetLines: true, fundRequests: { include: { lines: true } } }, orderBy: { sortOrder: 'asc' } });
    for (const c of clusters) {
      const setting = await settings.effective(c.projectId, ps);
      const calc = calcCluster(clusterCalcInput(c, setting));
      const amounts = frBudgetAmounts(calc);
      const hist = aggregateFrHistory(
        c.fundRequests.map((x) => ({ id: x.id, status: x.status, lines: x.lines.map((l) => ({ budgetCode: l.budgetCode, diajukan: l.diajukan.toString(), pctCair: l.pctCair.toString() })) })),
        null,
        c.terminOffset,
      );
      const real = await realisasiTanpaPengajuan(prisma, c.id);
      const bases = FR_CODES.map((k) => ({ code: k, budgetAmount: moneyStr(amounts[k]), sudahDicairkanSebelum: hist.sudahDicairkanSebelum[k], sedangDiproses: hist.sedangDiproses[k], realisasiTanpaPengajuan: real[k], pctCairSebelumnya: hist.pctCairSebelumnya[k] }));
      const pcts = frDefaultPcts(bases);
      const fr = computeFundRequest(calc.nilaiProyek, bases.map((b) => ({ ...b, pctCair: pcts[b.code] })));
      const cl = fr.cluster;
      console.log(
        `| ${code} | ${c.name} | ${f(cl.budget)} | ${f(fr.total.sudahDicairkanSebelum.plus(fr.total.sedangDiproses))} | ${f(fr.total.realisasiTanpaPengajuan)} | ${f(cl.overPos)} | ${f(fr.total.sisaTersedia)} | ${f(D.max(cl.sisaCluster, 0).toDecimalPlaces(0, D.ROUND_DOWN))} | ${f(fr.total.diajukan)} | ${hist.terminKe} |`,
      );
    }
  }
  const drafts = await prisma.fundRequest.findMany({ where: { status: 'DRAFT' }, include: { cluster: true } });
  console.log(`\nDraft terbuka: ${drafts.map((d) => `${d.number ?? `DRAFT-${d.id.slice(-6).toUpperCase()}`} (${d.cluster.name}, total ${f(d.totalDiajukan)})`).join('; ') || '-'}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
