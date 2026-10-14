import type { PrismaClient } from '@prisma/client';
import { formatAngka, generateTermins, moneyStr, terminTax } from '@indotek/shared';
import type { AuditService } from '../audit/audit.service';
import { rate } from '../common/decimal';
import { generateClientPayments } from '../realization/termin-generator';

export const PATCH_25 = '2.5-ccsi-ppn0-template-implementasi';
const ALASAN_PPN = 'konfirmasi user 14 Okt 2026: invoice CCSI tanpa PPN';
const ALASAN_TPL = 'konfirmasi user 14 Okt 2026: dokumen PO PT China Comservice (CCSI)';

/** Template termin implementasi CCSI (dokumen PO). Termin 4 = retensi 3 bulan dari tanggal opname. */
export const CCSI_IMPL_TEMPLATE: { pct: string; keterangan: string; retentionMonths?: number }[] = [
  { pct: '0.3', keterangan: 'MOS (approved Delivery Note)' },
  { pct: '0.3', keterangan: 'Implementation Done (EHS, Quality Selfcheck & SCC Manual Completed)' },
  { pct: '0.3', keterangan: 'ATP & Punchlist Clear (Doc ATP & Opname Signed)' },
  { pct: '0.1', keterangan: 'Retention 3 bulan dari tanggal Opname Signed', retentionMonths: 3 },
];

/**
 * Keputusan CCSI (14 Okt 2026), idempotent:
 *  A. Client CCSI ppnRate = 0; termin CCSI yang belum dibayar ikut PPN 0 (PPh tetap pajakRate cluster).
 *  B. TerminTemplate CCSI IMPLEMENTASI 30/30/30/10 (aging kosong → jatuh tempo manual); termin implementasi
 *     digenerate per PO implementasi. Termin PERMIT & SND tetap manual 1 × 100%.
 * commit=false → hanya rencana/diff (tidak menulis).
 */
export async function applyCcsiDecisions(prisma: PrismaClient, audit: AuditService, userId: string | null, commit: boolean): Promise<string[]> {
  const log: string[] = [];
  if (commit && (await prisma.dataPatch.findUnique({ where: { name: PATCH_25 } }))) return [];
  const client = await prisma.client.findUnique({ where: { name: 'CCSI' } });
  if (!client) return ['Patch 2.5 ditunda: client CCSI belum ada'];
  const f = (v: { toString(): string }) => formatAngka(moneyStr(v.toString()), 2);

  const run = async (db: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => {
    // A. PPN 0
    if (!client.ppnRate || !client.ppnRate.isZero()) {
      log.push(`A. Client CCSI ppnRate ${client.ppnRate?.toString() ?? '(global)'} → 0`);
      if (commit) {
        await db.client.update({ where: { id: client.id }, data: { ppnRate: rate('0') } });
        await audit.diff(db, userId, 'Client', client.id, { ppnRate: client.ppnRate?.toString() ?? null, alasan: null }, { ppnRate: '0', alasan: ALASAN_PPN });
      }
    }
    const open = await db.clientPayment.findMany({
      where: { cluster: { project: { clientId: client.id } }, status: { not: 'PAID' }, NOT: { ppnRate: 0 } },
      include: { cluster: true },
    });
    for (const p of open) {
      log.push(`A. termin ${p.cluster.name} ${p.kind} ${p.termin}: PPN ${p.ppnRate.toString()} → 0 (DPP ${f(p.amount)})`);
      if (commit) {
        await db.clientPayment.update({ where: { id: p.id }, data: { ppnRate: rate('0') } });
        await audit.diff(db, userId, 'ClientPayment', p.id, { ppnRate: p.ppnRate.toString(), alasan: null }, { ppnRate: '0', alasan: ALASAN_PPN });
      }
    }

    // B. template implementasi + generate per PO implementasi
    const tpl = await db.terminTemplate.findUnique({ where: { clientId_kind: { clientId: client.id, kind: 'IMPLEMENTASI' } } });
    if (!tpl) {
      log.push(`B. TerminTemplate CCSI IMPLEMENTASI: ${CCSI_IMPL_TEMPLATE.map((l) => `${Number(l.pct) * 100}%`).join(' / ')}, jatuh tempo manual`);
      if (commit) {
        const t = await db.terminTemplate.create({
          data: {
            clientId: client.id,
            kind: 'IMPLEMENTASI',
            agingDays: null,
            agingType: null,
            lines: { create: CCSI_IMPL_TEMPLATE.map((l, i) => ({ terminKe: i + 1, pct: l.pct, keterangan: l.keterangan, retentionMonths: l.retentionMonths ?? null })) },
          },
        });
        await audit.diff(db, userId, 'TerminTemplate', t.id, null, { client: 'CCSI', kind: 'IMPLEMENTASI', lines: CCSI_IMPL_TEMPLATE.map((l) => l.pct).join('/'), alasan: ALASAN_TPL });
      }
    }
    const clusters = await db.cluster.findMany({ where: { project: { clientId: client.id }, status: { not: 'CANCELLED' } }, include: { pos: true }, orderBy: { sortOrder: 'asc' } });
    for (const c of clusters) {
      for (const po of c.pos.filter((x) => x.kind === 'IMPLEMENTASI')) {
        const existing = await db.clientPayment.count({ where: { poId: po.id } });
        if (existing) {
          log.push(`B. ${c.name}: termin implementasi sudah ada (${existing}) — tidak diubah`);
          continue;
        }
        const rows = generateTermins(CCSI_IMPL_TEMPLATE.map((l, i) => ({ terminKe: i + 1, pct: l.pct, keterangan: l.keterangan })), po.amount.toString());
        for (const r of rows) {
          const tax = terminTax({ amount: r.amount, ppnRate: '0', pphRate: c.pajakRate.toString() });
          log.push(`B. ${c.name} IMPLEMENTASI termin ${r.terminKe} (${r.pct.times(100).toString()}%): BARU DPP ${f(r.amount)} · tagihan ${f(tax.invoiceTotal)} · net diharapkan ${f(tax.expectedNet)}`);
        }
      }
      if (commit) await generateClientPayments(db, c.id);
    }
    if (commit) await db.dataPatch.create({ data: { name: PATCH_25, note: log.join('; ').slice(0, 4000) } });
  };
  if (commit) await prisma.$transaction((tx) => run(tx), { timeout: 120_000 });
  else await run(prisma);
  return log;
}
