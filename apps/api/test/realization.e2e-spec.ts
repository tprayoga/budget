import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { clusterId, createApp } from './helpers';

const RAB = path.resolve(__dirname, '../../../docs/samples/RAB_Project_TELCO_-_IBK_1.sample.xlsx');
/** PNG 1×1 untuk foto nota webhook. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

let ctx: Awaited<ReturnType<typeof createApp>>;
let sinagar: string;
let rw08: string;
let rw04: string;
let gempol: string;

beforeAll(async () => {
  ctx = await createApp();
  sinagar = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Sinagar Tasik');
  rw08 = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Kersanagara RW 08 Tasik');
  rw04 = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Kersanagara RW 04 Tasik');
  gempol = await clusterId(ctx.prisma, 'ADW', 'Gempol Cirebon');
});
afterAll(async () => {
  await ctx.app.close();
});

type Row = { code: string; realisasi: string; menungguVerifikasi: string; budget: string; level: string };
async function realization(cid: string) {
  const res = await ctx.api('finance').get(`/clusters/${cid}/realization`).expect(200);
  const row = (code: string) => (res.body.rows as Row[]).find((r) => r.code === code)!;
  return { body: res.body, row };
}

function rabUpload(mode: 'dry-run' | 'commit', decisions?: object) {
  const { srv, auth } = ctx.api('finance').raw();
  const req = srv.post(`/api/import/rab-xlsx?mode=${mode}`).set(auth);
  if (decisions) req.field('decisions', JSON.stringify(decisions));
  return req.attach('file', readFileSync(RAB), 'RAB.xlsx');
}

describe('Termin klien otomatis dari template', () => {
  it('Evantama: implementasi 20/30/40/10 + permit 50/50; ADW 80/10/10', async () => {
    const ev = await ctx.api('finance').get(`/clusters/${sinagar}/client-payments`).expect(200);
    const impl = ev.body.payments.filter((p: { kind: string }) => p.kind === 'IMPLEMENTASI').map((p: { amount: string }) => p.amount);
    expect(impl).toEqual(['21788135.4', '32682203.1', '43576270.8', '10894067.7']);
    const permit = ev.body.payments.filter((p: { kind: string }) => p.kind === 'PERMIT').map((p: { amount: string }) => p.amount);
    expect(permit).toEqual(['18500000', '18500000']);
    const adw = await ctx.api('finance').get(`/clusters/${gempol}/client-payments`).expect(200);
    expect(adw.body.payments.map((p: { amount: string }) => p.amount)).toEqual(['35793200', '4474150', '4474150']);
  });

  it('cluster baru langsung mendapat termin', async () => {
    const ev = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' } });
    const c = await ctx.api('pm').post('/clusters', { projectId: ev.id, name: 'Cluster Uji Termin', nilaiPoImpl: '1000000', nilaiPoPermit: '0' }).expect(201);
    const t = await ctx.api('pm').get(`/clusters/${c.body.id}/client-payments`).expect(200);
    expect(t.body.payments).toHaveLength(4);
    await ctx.api('admin').del(`/clusters/${c.body.id}`).expect(200);
  });
});

describe('Acceptance K — pembayaran klien → expense PAJAK otomatis', () => {
  let paymentId: string;

  it('jatuh tempo 30 hari kalender dari tanggal invoice', async () => {
    const list = await ctx.api('finance').get(`/clusters/${sinagar}/client-payments`).expect(200);
    paymentId = list.body.payments.find((p: { kind: string; termin: number }) => p.kind === 'IMPLEMENTASI' && p.termin === 1).id;
    const res = await ctx.api('finance').patch(`/client-payments/${paymentId}`, { amount: '10000000', invoiceNo: 'I2628-TEST', invoiceDate: '2026-09-16' }).expect(200);
    expect(res.body).toMatchObject({ status: 'INVOICED', dueDate: '2026-10-16' });
  });

  it('bruto 10.000.000 diterima 9.735.000 → PAJAK 265.000; diubah 9.750.000 → 250.000', async () => {
    const paid = await ctx.api('finance').patch(`/client-payments/${paymentId}`, { paidDate: '2026-10-10', paidAmount: '9735000' }).expect(200);
    expect(paid.body).toMatchObject({ status: 'PAID', potongan: '265000.00' });
    const tax = () => ctx.prisma.expense.findUniqueOrThrow({ where: { sourceRef: `CLIENT_PAYMENT:${paymentId}` }, include: { allocations: true } });
    let e = await tax();
    expect(e).toMatchObject({ category: 'PAJAK', budgetCode: 'PAJAK', status: 'TERVERIFIKASI', source: 'CLIENT_PAYMENT' });
    expect(e.amount.toString()).toBe('265000');
    expect(e.allocations.map((a) => a.clusterId)).toEqual([sinagar]);

    await ctx.api('finance').patch(`/client-payments/${paymentId}`, { paidAmount: '9750000' }).expect(200);
    e = await tax();
    expect(e.amount.toString()).toBe('250000');

    // expense otomatis tidak bisa diedit / dihapus manual
    await ctx.api('finance').patch(`/expenses/${e.id}`, { amount: '1' }).expect(409);
    await ctx.api('admin').del(`/expenses/${e.id}`).expect(409);

    const r = await realization(sinagar);
    expect(r.row('PAJAK').realisasi).toBe('250000.00');
    expect(r.body.profit).toMatchObject({ pembayaranBruto: '10000000.00', kasDiterima: '9750000.00' });
  });

  it('PM tidak boleh mengubah termin klien', async () => {
    await ctx.api('pm').patch(`/client-payments/${paymentId}`, { invoiceNo: 'X' }).expect(403);
  });

  it('pembayaran dibatalkan (paid dikosongkan) → expense PAJAK terhapus', async () => {
    await ctx.api('finance').patch(`/client-payments/${paymentId}`, { paidDate: null, paidAmount: null }).expect(200);
    expect(await ctx.prisma.expense.findUnique({ where: { sourceRef: `CLIENT_PAYMENT:${paymentId}` } })).toBeNull();
    await ctx.api('finance').patch(`/client-payments/${paymentId}`, { paidDate: '2026-10-10', paidAmount: '9750000' }).expect(200);
  });

  it('aging 14 hari kerja melewati hari libur yang diatur ADMIN', async () => {
    await ctx.api('finance').post('/holidays', { date: '2026-10-01', name: 'Uji' }).expect(403);
    await ctx.api('admin').post('/holidays', { date: '2026-10-01', name: 'Libur uji' }).expect(201);
    const list = await ctx.api('finance').get(`/clusters/${sinagar}/client-payments`).expect(200);
    const permit1 = list.body.payments.find((p: { kind: string; termin: number }) => p.kind === 'PERMIT' && p.termin === 1).id;
    const res = await ctx.api('finance').patch(`/client-payments/${permit1}`, { invoiceDate: '2026-09-14' }).expect(200);
    expect(res.body.dueDate).toBe('2026-10-05');
  });
});

describe('Import RAB (dry-run → keputusan manual → commit)', () => {
  let opsKey: string;

  it('dry-run: blok cluster terpetakan otomatis; OPS & blok site perlu dipetakan manual', async () => {
    const res = await rabUpload('dry-run').expect(200);
    const items = res.body.items as { cell: string; sheet: string; status: string; target: { scope: string; clusterId?: string } | null; mappingKey: string; warnings: string[]; suggestedTarget: { method: string; clusterIds: string[] } | null }[];
    const at = (sheet: string, cell: string) => items.find((i) => i.sheet === sheet && i.cell === cell)!;
    expect(at('EVANTAMA', 'D36')).toMatchObject({ status: 'NEW', target: { scope: 'CLUSTER', clusterId: sinagar } });
    expect(at('ADW', 'D35').warnings.join(' ')).toMatch(/≠ formula total/);
    const ops = at('EVANTAMA', 'D49');
    expect(ops.status).toBe('NEEDS_MAPPING');
    expect(ops.suggestedTarget).toMatchObject({ method: 'EQUAL' });
    opsKey = ops.mappingKey;
    expect(at('CCSI', 'D35').status).toBe('NEEDS_MAPPING');
    expect(res.body.summary.NEEDS_MAPPING).toBeGreaterThan(10);
  });

  it('commit dengan keputusan OPS Evantama = project-level EQUAL 3 cluster', async () => {
    const res = await rabUpload('commit', { [opsKey]: { scope: 'PROJECT', clusterIds: [sinagar, rw08, rw04], method: 'EQUAL' } }).expect(200);
    expect(res.body.created).toBeGreaterThan(100);
    expect(res.body.preview.summary.NEW).toBe(0);
  });

  it('Acceptance G — Sinagar: SUBCON 45.637.060 (jasa 19.284.060 + material 26.353.000), PERMIT 37.000.000', async () => {
    const r = await realization(sinagar);
    expect(r.row('SUBCON').realisasi).toBe('45637060.00');
    expect(r.row('PERMIT').realisasi).toBe('37000000.00');
    const cat = (c: string) => r.body.byCategory.find((x: { category: string }) => x.category === c).realisasi;
    expect(cat('SUBCON_JASA')).toBe('19284060.00');
    expect(cat('SUBCON_MATERIAL')).toBe('26353000.00');
  });

  it('Acceptance J — OPS Evantama EQUAL: 3.578.533,33 / 3.578.533,33 / 3.578.533,34 (pos OPS_KANTOR)', async () => {
    expect((await realization(sinagar)).row('OPS_KANTOR').realisasi).toBe('3578533.33');
    expect((await realization(rw08)).row('OPS_KANTOR').realisasi).toBe('3578533.33');
    expect((await realization(rw04)).row('OPS_KANTOR').realisasi).toBe('3578533.34');
  });

  it('Acceptance I — Gempol: SUBCON 18.293.488 (jasa 13.339.200, material 4.954.288)', async () => {
    const r = await realization(gempol);
    expect(r.row('SUBCON').realisasi).toBe('18293488.00');
    const cat = (c: string) => r.body.byCategory.find((x: { category: string }) => x.category === c).realisasi;
    expect(cat('SUBCON_JASA')).toBe('13339200.00');
    expect(cat('SUBCON_MATERIAL')).toBe('4954288.00');
  });

  it('import ulang: keputusan diingat, semua UNCHANGED (idempotent)', async () => {
    const res = await rabUpload('dry-run').expect(200);
    const ops = res.body.items.filter((i: { mappingKey: string }) => i.mappingKey === opsKey);
    expect(ops.every((i: { status: string; targetSource: string }) => i.status === 'UNCHANGED' && i.targetSource === 'RULE')).toBe(true);
    expect(res.body.summary.NEW).toBe(0);
    expect(res.body.summary.CHANGED).toBe(0);
  });

  it('PRO_RATA_PO memakai nilaiPoImpl: 6.306.352,74 / 2.019.291,44 / 2.409.955,82', async () => {
    const res = await rabUpload('commit', { [opsKey]: { scope: 'PROJECT', clusterIds: [sinagar, rw08, rw04], method: 'PRO_RATA_PO' } }).expect(200);
    expect(res.body.updated).toBe(12);
    expect((await realization(sinagar)).row('OPS_KANTOR').realisasi).toBe('6306352.74');
    expect((await realization(rw08)).row('OPS_KANTOR').realisasi).toBe('2019291.44');
    expect((await realization(rw04)).row('OPS_KANTOR').realisasi).toBe('2409955.82');
    await rabUpload('commit', { [opsKey]: { scope: 'PROJECT', clusterIds: [sinagar, rw08, rw04], method: 'EQUAL' } }).expect(200);
    expect((await realization(rw04)).row('OPS_KANTOR').realisasi).toBe('3578533.34');
  });

  it('PM tidak boleh import realisasi', async () => {
    const { srv, auth } = ctx.api('pm').raw();
    await srv.post('/api/import/rab-xlsx').set(auth).attach('file', readFileSync(RAB), 'RAB.xlsx').expect(403);
  });
});

describe('Acceptance L — webhook bot: tidak dihitung sebelum diverifikasi FINANCE', () => {
  let key: string;
  let expenseId: string;

  it('ADMIN membuat API key (ditampilkan sekali)', async () => {
    await ctx.api('finance').post('/api-keys', { name: 'Bot' }).expect(403);
    const res = await ctx.api('admin').post('/api-keys', { name: 'Bot Telegram' }).expect(201);
    key = res.body.key;
    expect(key).toMatch(/^ibk_/);
    const list = await ctx.api('admin').get('/api-keys').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(key);
  });

  it('kiriman bot → PERLU_VERIFIKASI; realisasi tidak berubah', async () => {
    const before = (await realization(gempol)).row('OPS_KANTOR');
    const res = await request(ctx.app.getHttpServer())
      .post('/api/webhooks/expenses')
      .set('X-API-Key', key)
      .send({ cluster: 'Gempol Cirebon', kategori: 'ops', nominal: 500000, tanggal: '2026-10-12', externalId: 'tg-1', fotoBase64: `data:image/png;base64,${PNG_1PX}` })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'PERLU_VERIFIKASI', duplicate: false });
    expenseId = res.body.id;
    const after = (await realization(gempol)).row('OPS_KANTOR');
    expect(after.realisasi).toBe(before.realisasi);
    expect(after.menungguVerifikasi).toBe('500000.00');
    const e = await ctx.api('finance').get(`/expenses/${expenseId}`).expect(200);
    expect(e.body).toMatchObject({ source: 'WEBHOOK', hasAttachment: true, apiKey: { name: 'Bot Telegram' } });
  });

  it('kiriman ulang dengan externalId sama → tidak dobel', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/webhooks/expenses')
      .set('X-API-Key', key)
      .send({ cluster: 'Gempol Cirebon', kategori: 'OPS', nominal: 500000, tanggal: '2026-10-12', externalId: 'tg-1' })
      .expect(201);
    expect(res.body).toMatchObject({ id: expenseId, duplicate: true });
  });

  it('API key salah / cluster tidak dikenal / kategori tanpa pos', async () => {
    const post = (k: string, body: object) => request(ctx.app.getHttpServer()).post('/api/webhooks/expenses').set('X-API-Key', k).send(body);
    await post('ibk_salah_xxxxxxxxxxxxxxxxxxxx', { cluster: 'Gempol Cirebon', kategori: 'OPS', nominal: 1, tanggal: '2026-10-12' }).expect(401);
    const unknown = await post(key, { cluster: 'Tidak Ada', kategori: 'OPS', nominal: 1, tanggal: '2026-10-12' }).expect(422);
    expect(unknown.body.code).toBe('CLUSTER');
    await post(key, { cluster: 'Gempol Cirebon', kategori: 'LAINNYA', nominal: 1, tanggal: '2026-10-12' }).expect(422);
  });

  it('PM tidak bisa memverifikasi; FINANCE verifikasi → realisasi bertambah 500.000', async () => {
    const before = (await realization(gempol)).row('OPS_KANTOR').realisasi;
    await ctx.api('pm').post(`/expenses/${expenseId}/verify`).expect(403);
    await ctx.api('finance').post(`/expenses/${expenseId}/verify`).expect(200);
    const after = (await realization(gempol)).row('OPS_KANTOR');
    expect(Number(after.realisasi) - Number(before)).toBe(500000);
    expect(after.menungguVerifikasi).toBe('0.00');
  });
});

describe('Input manual: PM perlu verifikasi, FINANCE langsung terverifikasi', () => {
  it('status sesuai role & hak ubah', async () => {
    const pm = await ctx.api('pm').post('/expenses', { clusterId: gempol, date: '2026-10-13', category: 'TICKET', description: 'Tiket kereta', amount: '350000' }).expect(201);
    expect(pm.body).toMatchObject({ status: 'PERLU_VERIFIKASI', budgetCode: 'TICKET' });
    await ctx.api('pm').patch(`/expenses/${pm.body.id}`, { amount: '360000' }).expect(200);
    const rej = await ctx.api('finance').post(`/expenses/${pm.body.id}/reject`, { note: 'Nota tidak jelas' }).expect(200);
    expect(rej.body.status).toBe('DITOLAK');
    const resub = await ctx.api('pm').patch(`/expenses/${pm.body.id}`, { description: 'Tiket kereta (nota baru)' }).expect(200);
    expect(resub.body.status).toBe('PERLU_VERIFIKASI');

    const fin = await ctx.api('finance').post('/expenses', { clusterId: gempol, date: '2026-10-13', category: 'HOMEBASE', description: 'Sewa homebase', amount: '1000000' }).expect(201);
    expect(fin.body.status).toBe('TERVERIFIKASI');
    await ctx.api('pm').patch(`/expenses/${fin.body.id}`, { amount: '1' }).expect(403);
    await ctx.api('direktur').post('/expenses', { clusterId: gempol, date: '2026-10-13', category: 'OPS', description: 'x', amount: '1' }).expect(403);
  });

  it('kategori LAINNYA wajib memilih pos budget', async () => {
    await ctx.api('finance').post('/expenses', { clusterId: gempol, date: '2026-10-13', category: 'LAINNYA', description: 'Lain', amount: '1000' }).expect(400);
    const ok = await ctx.api('finance').post('/expenses', { clusterId: gempol, date: '2026-10-13', category: 'LAINNYA', budgetCode: 'MARKETING', description: 'Lain', amount: '1000' }).expect(201);
    expect(ok.body.budgetCode).toBe('MARKETING');
  });

  it('biaya project-level MANUAL wajib berjumlah sama', async () => {
    const ev = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' } });
    await ctx.api('finance')
      .post('/expenses', { projectId: ev.id, clusterId: null, allocationMethod: 'MANUAL', manualAllocations: [{ clusterId: sinagar, amount: '100' }, { clusterId: rw08, amount: '50' }], clusterIds: [sinagar, rw08], date: '2026-10-13', category: 'MOTOR_MOBIL', description: 'Sewa mobil', amount: '200' })
      .expect(400);
    const ok = await ctx.api('finance')
      .post('/expenses', { projectId: ev.id, clusterId: null, allocationMethod: 'MANUAL', manualAllocations: [{ clusterId: sinagar, amount: '150' }, { clusterId: rw08, amount: '50' }], clusterIds: [sinagar, rw08], date: '2026-10-13', category: 'MOTOR_MOBIL', description: 'Sewa mobil', amount: '200' })
      .expect(201);
    expect(ok.body.allocations.map((a: { amount: string }) => a.amount)).toEqual(['150', '50']);
  });
});

describe('Tautan ke pengajuan dana: dana cair vs realisasi vs sisa', () => {
  it('hanya ke pengajuan DICAIRKAN; panel & PDF laporan; lampiran otomatis di pengajuan berikutnya', async () => {
    const cid = await clusterId(ctx.prisma, 'ADW', 'SARIREJA RW 01 SUBANG');
    const lines = ['SUBCON', 'PERMIT', 'TICKET', 'PAJAK', 'INDIRECT', 'DIRECT', 'OPS_KANTOR', 'MOTOR_MOBIL', 'HOMEBASE', 'ALLOWANCE', 'MARKETING'].map((budgetCode) => ({ budgetCode, pctCair: '0.5' }));
    const fr = await ctx.api('pm').post('/fund-requests', { clusterId: cid, lines }).expect(201);
    const exp = await ctx.api('finance').post('/expenses', { clusterId: cid, date: '2026-10-13', category: 'SUBCON_JASA', description: 'DP subcon', amount: '1000000' }).expect(201);
    // belum dicairkan → ditolak
    await ctx.api('finance').post(`/expenses/${exp.body.id}/fund-request`, { fundRequestId: fr.body.id }).expect(400);

    await ctx.api('pm').post(`/fund-requests/${fr.body.id}/submit`).expect(200);
    await ctx.api('finance').post(`/fund-requests/${fr.body.id}/approve`).expect(200);
    await ctx.api('direktur').post(`/fund-requests/${fr.body.id}/approve`).expect(200);
    await ctx.api('investor').post(`/fund-requests/${fr.body.id}/approve`).expect(200);
    const { srv, auth } = ctx.api('finance').raw();
    await srv
      .post(`/api/fund-requests/${fr.body.id}/disburse`)
      .set(auth)
      .field('cairTanggal', '2026-10-13')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'bukti.pdf', contentType: 'application/pdf' })
      .expect(200);

    await ctx.api('finance').post(`/expenses/${exp.body.id}/fund-request`, { fundRequestId: fr.body.id }).expect(200);
    const usage = await ctx.api('pm').get(`/fund-requests/${fr.body.id}/realization`).expect(200);
    const subcon = usage.body.rows.find((r: { code: string }) => r.code === 'SUBCON');
    const frDetail = await ctx.api('pm').get(`/fund-requests/${fr.body.id}`).expect(200);
    const cair = frDetail.body.lines.find((l: { budgetCode: string }) => l.budgetCode === 'SUBCON').diajukan;
    expect(subcon).toMatchObject({ cair, realisasi: '1000000.00' });
    expect(Number(subcon.sisa)).toBe(Number(cair) - 1000000);
    expect(usage.body.expenses).toHaveLength(1);

    const pdf = await srv.get(`/api/fund-requests/${fr.body.id}/realization-report.pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // pengajuan termin berikutnya → lampiran laporan realisasi otomatis
    const next = await ctx.api('pm').post('/fund-requests', { clusterId: cid, lines }).expect(201);
    expect(next.body.terminKe).toBe(2);
    const gen = await ctx.api('pm').post(`/fund-requests/${next.body.id}/attachments/previous-report`).expect(200);
    expect(gen.body.previous.id).toBe(fr.body.id);
    const detail = await ctx.api('pm').get(`/fund-requests/${next.body.id}`).expect(200);
    const att = detail.body.attachments.find((a: { kind: string; hasFile: boolean }) => a.kind === 'LAPORAN_TERMIN_SEBELUMNYA' && a.hasFile);
    expect(att).toMatchObject({ checked: true, mimeType: 'application/pdf' });
  }, 60000);
});

describe('Buku kas & rekonsiliasi', () => {
  it('import buku kas (nilai cache) idempotent; rekonsiliasi per bulan', async () => {
    const { srv, auth } = ctx.api('finance').raw();
    const dry = await srv.post('/api/import/cash-ledger-xlsx').set(auth).attach('file', readFileSync(RAB), 'RAB.xlsx').expect(200);
    expect(dry.body.summary).toMatchObject({ total: 290, new: 290 });
    expect(dry.body.projectLabels.EVANTAMA.matched).toBe(true);
    expect(dry.body.projectLabels.RPJ.matched).toBe(false);
    const c1 = await srv.post('/api/import/cash-ledger-xlsx?mode=commit').set(auth).attach('file', readFileSync(RAB), 'RAB.xlsx').expect(200);
    expect(c1.body.created).toBe(290);
    const c2 = await srv.post('/api/import/cash-ledger-xlsx?mode=commit').set(auth).attach('file', readFileSync(RAB), 'RAB.xlsx').expect(200);
    expect(c2.body.created).toBe(0);

    const ev = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' } });
    const rec = await ctx.api('finance').get(`/projects/${ev.id}/reconciliation`).expect(200);
    const ledgerOut = await ctx.prisma.cashLedger.aggregate({ where: { projectId: ev.id }, _sum: { cashOut: true } });
    expect(rec.body.total.cashOut).toBe(Number(ledgerOut._sum.cashOut).toFixed(2));
    const verified = await ctx.prisma.expense.aggregate({ where: { projectId: ev.id, status: 'TERVERIFIKASI' }, _sum: { amount: true } });
    expect(rec.body.total.expense).toBe(Number(verified._sum.amount).toFixed(2));
    expect(rec.body.rows.some((r: { month: string }) => r.month === '2026-07')).toBe(true);
  });

  it('investor hanya melihat project-nya', async () => {
    const ev = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' } });
    await ctx.api('investor').get(`/projects/${ev.id}/reconciliation`).expect(404);
    await ctx.api('investor').get(`/clusters/${sinagar}/realization`).expect(404);
    const list = await ctx.api('investor').get(`/expenses?projectId=${ev.id}`).expect(200);
    expect(list.body).toEqual([]);
    const ledger = await ctx.api('investor').get('/import/cash-ledger').expect(200);
    expect(ledger.body.every((r: { project: string }) => r.project === 'ADW')).toBe(true);
  });
});

describe('Rekap memuat realisasi per cluster', () => {
  it('kolom realisasi & profit realisasi', async () => {
    const res = await ctx.api('direktur').get('/budget/rekap').expect(200);
    const ev = res.body.projects.find((p: { project: { code: string } }) => p.project.code === 'EVANTAMA');
    const s = ev.clusters.find((c: { id: string }) => c.id === sinagar);
    expect(s.realisasi).toMatchObject({ pembayaranBruto: '10000000.00', kasDiterima: '9750000.00' });
    expect(Number(s.realisasi.realisasiBiaya)).toBeGreaterThan(80000000);
  });
});
