/* Pecah PO implementasi EVANTAMA menjadi 2 ClusterPo (CLUSTER + SUBFEEDER) per cluster — keputusan Fase 2.4 (c).
 * Default DRY-RUN (tidak mengubah data): tampilkan diff PO, diff termin, dan simulasi pencocokan referensi.
 * Pemakaian: npx ts-node --transpile-only scripts/split-evantama-po.ts [--commit]
 */
import { PrismaClient } from '@prisma/client';
import { dec, formatAngka, generateTermins, matchReferenceToTermin, moneyStr, sum, terminTax } from '@indotek/shared';
import { AuditService } from '../src/audit/audit.service';
import { money } from '../src/common/decimal';
import { poFlat } from '../src/clusters/po-support';
import { recalcCluster, referenceMatches } from '../src/realization/client-payments.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const NOTE = 'nilai dari sheet BOQ Plan — cocokkan dengan dokumen PO';
const PLAN = [
  { cluster: 'Cluster Sinagar Tasik', total: '108940677', parts: [['CLUSTER', '754/FTTH/ENS/0826', '85025796'], ['SUBFEEDER', '978/FTTH/ENS/0926', '23914881']] },
  { cluster: 'Cluster Kersanagara RW 08 Tasik', total: '34882758', parts: [['CLUSTER', '976/FTTH/ENS/0926', '26856780'], ['SUBFEEDER', '977/FTTH/ENS/0926', '8025978']] },
  { cluster: 'Cluster Kersanagara RW 04 Tasik', total: '41631388', parts: [['CLUSTER', '979/FTTH/ENS/0926', '27902437'], ['SUBFEEDER', '980/FTTH/ENS/0926', '13728951']] },
] as const;

async function main() {
  const commit = process.argv.includes('--commit');
  const prisma = new PrismaClient();
  const audit = new AuditService(prisma as unknown as PrismaService);
  const f = (v: { toString(): string }) => formatAngka(moneyStr(v.toString()));
  const project = await prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' }, include: { client: true } });
  const tpl = await prisma.terminTemplate.findUnique({ where: { clientId_kind: { clientId: project.clientId, kind: 'IMPLEMENTASI' } }, include: { lines: true } });
  if (!tpl) throw new Error('Template termin implementasi EVANTAMA tidak ada');
  const tplLines = tpl.lines.map((l) => ({ terminKe: l.terminKe, pct: l.pct.toString(), keterangan: l.keterangan }));
  const errors: string[] = [];
  const simTermins: { id: string; clusterId: string; termin: number; expectedNet: string; label: string }[] = [];

  console.log(`=== ${commit ? 'COMMIT' : 'DRY-RUN'} — pecah PO implementasi EVANTAMA (${NOTE})`);
  for (const p of PLAN) {
    const c = await prisma.cluster.findFirstOrThrow({ where: { projectId: project.id, name: p.cluster } });
    const impl = await prisma.clusterPo.findMany({ where: { clusterId: c.id, kind: 'IMPLEMENTASI' }, include: { termins: { orderBy: { termin: 'asc' } } } });
    const partsSum = sum(p.parts.map((x) => x[2]));
    console.log(`\n-- ${p.cluster} (nilaiPoImpl ${f(c.nilaiPoImpl)})`);
    if (impl.length !== 1) errors.push(`${p.cluster}: PO implementasi ada ${impl.length} (diharapkan 1 — mungkin sudah dipecah)`);
    if (!partsSum.eq(p.total) || !dec(impl[0]?.amount.toString() ?? 0).eq(p.total)) errors.push(`${p.cluster}: total ${f(partsSum)} ≠ PO sekarang ${f(impl[0]?.amount ?? 0)}`);
    const po = impl[0];
    if (!po) continue;
    console.log(`   PO sebelum : IMPLEMENTASI ${po.poNumber ?? '-'} = ${f(po.amount)}`);
    console.log(`   PO sesudah : IMPLEMENTASI/CLUSTER ${p.parts[0][1]} = ${f(p.parts[0][2])} (PO yang ada diubah)`);
    console.log(`                IMPLEMENTASI/SUBFEEDER ${p.parts[1][1]} = ${f(p.parts[1][2])} (PO baru)`);
    console.log(`                total ${f(partsSum)} ${partsSum.eq(p.total) ? '= sama' : '≠ BERBEDA'}`);
    const locked = po.termins.filter((t) => t.status !== 'UNBILLED');
    if (locked.length) errors.push(`${p.cluster}: ${locked.length} termin implementasi sudah ditagih/dibayar`);
    const ppnRate = po.termins[0]?.ppnRate.toString() ?? '0.11';
    const pphRate = po.termins[0]?.pphRate.toString() ?? c.pajakRate.toString();
    const newCluster = generateTermins(tplLines, p.parts[0][2]);
    const newSub = generateTermins(tplLines, p.parts[1][2]);
    console.log('   Termin implementasi (DPP):');
    for (const t of newCluster) {
      const old = po.termins.find((x) => x.termin === t.terminKe);
      const net = terminTax({ amount: t.amount, ppnRate, pphRate }).expectedNet;
      console.log(`      CLUSTER   termin ${t.terminKe}: ${old ? f(old.amount) : '—'} → ${f(t.amount)}  (net diharapkan ${f(net)})`);
      simTermins.push({ id: old?.id ?? `new-${c.id}-C${t.terminKe}`, clusterId: c.id, termin: t.terminKe, expectedNet: moneyStr(net), label: `${p.cluster} CLUSTER termin ${t.terminKe}` });
    }
    for (const t of newSub) {
      const net = terminTax({ amount: t.amount, ppnRate, pphRate }).expectedNet;
      console.log(`      SUBFEEDER termin ${t.terminKe}: — → ${f(t.amount)} (BARU)  (net diharapkan ${f(net)})`);
      simTermins.push({ id: `new-${c.id}-S${t.terminKe}`, clusterId: c.id, termin: t.terminKe, expectedNet: moneyStr(net), label: `${p.cluster} SUBFEEDER termin ${t.terminKe}` });
    }
    console.log(`      Σ termin implementasi ${f(sum(po.termins.map((t) => t.amount.toString())))} → ${f(sum([...newCluster, ...newSub].map((t) => t.amount)))}`);
  }

  // simulasi pencocokan referensi implementasi yang belum diterapkan
  const refs = await prisma.clientInvoiceRef.findMany({ where: { projectId: project.id, appliedPaymentId: null, blockTitle: { contains: 'Implementasi' } } });
  console.log('\n=== Simulasi pencocokan referensi implementasi setelah pemecahan (net = DPP + PPN − PPh ± Rp 10)');
  const taken = new Set<string>();
  let ok = 0;
  for (const r of refs) {
    const block = r.blockTitle ?? '';
    const sub = /subfeeder/i.test(block);
    const cands = simTermins.filter((t) => !taken.has(t.id) && t.label.includes(sub ? 'SUBFEEDER' : 'CLUSTER'));
    const m = matchReferenceToTermin({ netAmount: r.netAmount?.toString() ?? null, termin: r.termin }, cands);
    if (m.match) {
      taken.add(m.match.id);
      ok++;
    }
    console.log(`   ${r.invoiceNo} ${block} net ${f(r.netAmount ?? 0)} → ${m.match ? `COCOK ${m.match.label} (net ${f(m.match.expectedNet)})` : 'tidak cocok'}`);
  }
  console.log(`   Cocok: ${ok} dari ${refs.length}`);

  if (errors.length) {
    console.log(`\nTIDAK BISA DITERAPKAN:\n - ${errors.join('\n - ')}`);
    process.exitCode = commit ? 1 : 0;
  }
  if (!commit || errors.length) {
    if (!commit) console.log('\n(dry-run — tidak ada data yang diubah; jalankan dengan --commit setelah disetujui)');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      for (const p of PLAN) {
        const c = await tx.cluster.findFirstOrThrow({ where: { projectId: project.id, name: p.cluster } });
        const po = await tx.clusterPo.findFirstOrThrow({ where: { clusterId: c.id, kind: 'IMPLEMENTASI' } });
        const after = await tx.clusterPo.update({ where: { id: po.id }, data: { subKind: 'CLUSTER', poNumber: p.parts[0][1], amount: money(p.parts[0][2]), note: NOTE } });
        await audit.diff(tx, null, 'ClusterPo', po.id, { ...poFlat(po)!, subKind: po.subKind }, { ...poFlat(after)!, subKind: 'CLUSTER', alasan: 'keputusan user Fase 2.4 (c)' });
        const sub = await tx.clusterPo.create({
          data: { clusterId: c.id, kind: 'IMPLEMENTASI', subKind: 'SUBFEEDER', poNumber: p.parts[1][1], amount: money(p.parts[1][2]), note: NOTE, sourceRef: `SPLIT:${c.id}:SUBFEEDER` },
        });
        await audit.diff(tx, null, 'ClusterPo', sub.id, null, { ...poFlat(sub)!, subKind: 'SUBFEEDER', alasan: 'keputusan user Fase 2.4 (c)' });
        const res = await recalcCluster(tx, audit, null, c.id, true);
        const err = res.kinds.find((k) => k.error);
        if (err) throw new Error(`${p.cluster}: ${err.error}`);
      }
    },
    { timeout: 120_000 },
  );
  console.log('\nCOMMIT selesai. Pencocokan referensi ulang:');
  const { refs: all, matches } = await referenceMatches(prisma, project.id);
  const open = all.filter((r) => !r.appliedPaymentId);
  console.log(`   ${open.filter((r) => matches.get(r.id)?.suggestion?.mode === 'NET').length} dari ${open.length} referensi terbuka cocok`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
