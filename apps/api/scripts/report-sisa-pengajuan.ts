/* Laporan READ-ONLY: per cluster — budget total, realisasi tanpa pengajuan, sisa yang bisa diajukan (sama dengan wizard).
 * Pemakaian: npx ts-node --transpile-only scripts/report-sisa-pengajuan.ts [KODE_PROJECT ...]
 */
import { PrismaClient } from '@prisma/client';
import { aggregateFrHistory, calcCluster, computeFundRequest, formatAngka, frBudgetAmounts, frDefaultPctCair, FR_CODES, moneyStr } from '@indotek/shared';
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
  console.log('| Project | Cluster | Budget total | Sudah dicairkan | Realisasi tanpa pengajuan | Sisa yang bisa diajukan | Pos habis/over | Termin ke |');
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
      const fr = computeFundRequest(
        calc.nilaiProyek,
        FR_CODES.map((k) => {
          const base = { code: k, budgetAmount: moneyStr(amounts[k]), sudahDicairkanSebelum: hist.sudahDicairkanSebelum[k], sedangDiproses: hist.sedangDiproses[k], realisasiTanpaPengajuan: real[k], pctCairSebelumnya: hist.pctCairSebelumnya[k] };
          return { ...base, pctCair: frDefaultPctCair(base) };
        }),
      );
      const habis = fr.lines.filter((l) => l.habis && !l.budgetAmount.isZero()).map((l) => `${l.code}${l.sisaTersedia.lte(-1) ? ` over ${f(l.sisaTersedia.neg())}` : ''}`);
      console.log(`| ${code} | ${c.name} | ${f(fr.total.budgetAmount.toDecimalPlaces(0))} | ${f(fr.total.sudahDicairkanSebelum)} | ${f(fr.total.realisasiTanpaPengajuan)} | ${f(fr.total.sisaTersedia)} | ${habis.join(', ') || '-'} | ${hist.terminKe} |`);
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
