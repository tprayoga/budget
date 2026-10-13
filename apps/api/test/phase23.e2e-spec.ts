import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { moneyStr, sum } from '@indotek/shared';
import { clusterId, createApp } from './helpers';

const RAB = path.resolve(__dirname, '../../../docs/samples/RAB_Project_TELCO_-_IBK_1.sample.xlsx');
const SAMPLE = path.resolve(__dirname, '../../../docs/samples/Budget_Per_Cluster_ADW_Evantama_CCSI.sample.xlsx');

let ctx: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  ctx = await createApp();
});
afterAll(async () => {
  await ctx.app.close();
});

const cluster = (id: string) => ctx.prisma.cluster.findUniqueOrThrow({ where: { id } });

describe('PO per cluster (ClusterPo) — nilai turunan, termin per PO, audit', () => {
  it('migrasi: setiap cluster punya PO IMPLEMENTASI; nomor PO dari info', async () => {
    const without = await ctx.prisma.cluster.count({ where: { pos: { none: { kind: 'IMPLEMENTASI' } } } });
    expect(without).toBe(0);
    const gempol = await clusterId(ctx.prisma, 'ADW', 'Gempol Cirebon');
    const po = await ctx.prisma.clusterPo.findFirstOrThrow({ where: { clusterId: gempol, kind: 'IMPLEMENTASI' } });
    expect(po.amount.toString()).toBe((await cluster(gempol)).nilaiPoImpl.toString());
    // termin lama terkait ke PO
    expect(await ctx.prisma.clientPayment.count({ where: { poId: null } })).toBe(0);
  });

  it('ADDWORK & DEDUCTION: nilaiPoImpl = Σ IMPLEMENTASI + ADDWORK + DEDUCTION; termin 1 × 100% manual; validasi tanda', async () => {
    const id = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 02 SUBANG');
    const before = (await cluster(id)).nilaiPoImpl.toString();
    await ctx.api('finance').post(`/clusters/${id}/pos`, { kind: 'ADDWORK', amount: '100000' }).expect(403);
    await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'DEDUCTION', amount: '50000' }).expect(400);
    await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'ADDWORK', amount: '-1' }).expect(400);
    const add = await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'ADDWORK', poNumber: 'ADD-UJI', amount: '400000' }).expect(201);
    const ded = await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'DEDUCTION', amount: '-150000', note: 'uji' }).expect(201);
    expect((await cluster(id)).nilaiPoImpl.toString()).toBe(moneyStr(sum([before, '400000', '-150000'])).replace(/\.00$/, ''));
    const t = await ctx.api('finance').get(`/clusters/${id}/client-payments`).expect(200);
    const addT = t.body.payments.filter((p: { poId: string }) => p.poId === add.body.id);
    expect(addT).toEqual([expect.objectContaining({ kind: 'ADDWORK', termin: 1, amount: '400000', fromTemplate: false, needsInvoiceDate: true })]);
    expect(t.body.payments.find((p: { poId: string }) => p.poId === ded.body.id)).toMatchObject({ kind: 'DEDUCTION', amount: '-150000' });
    // audit: PO + nilai cluster lama → baru; field ditandai diedit di aplikasi
    expect(await ctx.prisma.auditLog.count({ where: { entity: 'ClusterPo', entityId: add.body.id } })).toBeGreaterThan(0);
    const log = await ctx.prisma.auditLog.findFirst({ where: { entity: 'Cluster', entityId: id, field: 'nilaiPoImpl' }, orderBy: { at: 'desc' } });
    expect(log?.oldValue).toBeTruthy();
    expect(await ctx.prisma.fieldOverride.findUnique({ where: { entity_entityId_field: { entity: 'Cluster', entityId: id, field: 'nilaiPoImpl' } } })).not.toBeNull();
    // hapus → termin UNBILLED ikut terhapus, nilai kembali
    await ctx.api('pm').del(`/clusters/pos/${add.body.id}`).expect(200);
    await ctx.api('pm').del(`/clusters/pos/${ded.body.id}`).expect(200);
    expect((await cluster(id)).nilaiPoImpl.toString()).toBe(before);
    await ctx.prisma.fieldOverride.deleteMany({ where: { entityId: id } });
  });

  it('nilai PO tidak bisa diedit langsung di cluster; PO implementasi terakhir tidak bisa dihapus', async () => {
    const id = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 02 SUBANG');
    await ctx.api('pm').patch(`/clusters/${id}`, { nilaiPoPermit: '1000' }).expect(400);
    const po = await ctx.prisma.clusterPo.findFirstOrThrow({ where: { clusterId: id, kind: 'IMPLEMENTASI' } });
    await ctx.api('pm').del(`/clusters/pos/${po.id}`).expect(409);
  });
});

describe('Proteksi import budget (manualOverride)', () => {
  const evKey = 'EVANTAMA::Cluster Kersanagara RW 04 Tasik';
  let id: string;
  let original: string;

  function budgetUpload(who: 'pm' | 'admin', mode: 'dry-run' | 'commit', buf: Buffer, extra: Record<string, string> = {}) {
    const { srv, auth } = ctx.api(who).raw();
    const req = srv.post(`/api/import/budget-xlsx?mode=${mode}`).set(auth);
    for (const [k, v] of Object.entries(extra)) req.field(k, v);
    return req.attach('file', buf, 'b.xlsx');
  }

  it('edit di aplikasi → field ditandai; dry-run menampilkan "dilindungi — diedit di aplikasi"; commit melewatinya', async () => {
    id = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Kersanagara RW 04 Tasik');
    original = (await cluster(id)).pajakRate.toString();
    await ctx.api('pm').patch(`/clusters/${id}`, { pajakRate: '0.03' }).expect(200);
    const o = await ctx.prisma.fieldOverride.findUniqueOrThrow({ where: { entity_entityId_field: { entity: 'Cluster', entityId: id, field: 'pajakRate' } } });
    expect(o.userId).toBeTruthy();
    const dry = await budgetUpload('pm', 'dry-run', readFileSync(SAMPLE)).expect(200);
    const row = dry.body.clusters.find((c: { key: string }) => c.key === evKey);
    expect(row.status).toBe('PROTECTED');
    expect(row.diffs).toEqual([expect.objectContaining({ field: 'pajakRate', newValue: original, protected: true, protectedReason: 'dilindungi — diedit di aplikasi', overriddenBy: expect.any(String) })]);
    const commit = await budgetUpload('pm', 'commit', readFileSync(SAMPLE), { keys: JSON.stringify([evKey]) }).expect(200);
    expect(commit.body.updated).toBe(0);
    expect((await cluster(id)).pajakRate.toString()).toBe('0.03');
  });

  it('timpa per field hanya ADMIN + alasan; tercatat di audit; tanda dilepas', async () => {
    const force = JSON.stringify({ [evKey]: ['pajakRate'] });
    await budgetUpload('pm', 'commit', readFileSync(SAMPLE), { force, reason: 'x' }).expect(403);
    await budgetUpload('admin', 'commit', readFileSync(SAMPLE), { force }).expect(400);
    const res = await budgetUpload('admin', 'commit', readFileSync(SAMPLE), { keys: JSON.stringify([evKey]), force, reason: 'nilai resmi dari file direksi' }).expect(200);
    expect(res.body.updated).toBe(1);
    expect((await cluster(id)).pajakRate.toString()).toBe(original);
    const reason = await ctx.prisma.auditLog.findFirst({ where: { entity: 'Cluster', entityId: id, field: 'alasan' }, orderBy: { at: 'desc' } });
    expect(reason?.newValue).toBe('nilai resmi dari file direksi');
    expect(await ctx.prisma.fieldOverride.count({ where: { entityId: id, field: 'pajakRate' } })).toBe(0);
  });

  it('file mengubah nilai PO implementasi → ditulis ke PO IMPLEMENTASI (nilai cluster diturunkan)', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(SAMPLE);
    const ws = wb.getWorksheet('EVANTAMA')!;
    const before = (await cluster(id)).nilaiPoImpl.toString();
    ws.getCell('I4').value = 41000000; // Nilai PO Implementasi Kersanagara RW 04 (kolom Rp ketiga)
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await budgetUpload('pm', 'commit', buf, { keys: JSON.stringify([evKey]) }).expect(200);
    const po = await ctx.prisma.clusterPo.findFirstOrThrow({ where: { clusterId: id, kind: 'IMPLEMENTASI' } });
    expect(po.amount.toString()).toBe('41000000');
    expect((await cluster(id)).nilaiPoImpl.toString()).toBe('41000000');
    await budgetUpload('pm', 'commit', readFileSync(SAMPLE), { keys: JSON.stringify([evKey]) }).expect(200);
    expect((await cluster(id)).nilaiPoImpl.toString()).toBe(before);
  });
});

describe('Notifikasi over budget (PM & DIREKTUR) + daftar Rekap', () => {
  it('pos melewati 100% → notifikasi sekali; kembali di bawah → notifikasi dilepas', async () => {
    const id = await clusterId(ctx.prisma, 'ADW', 'SINDANG RW 01 MAJALENGKA');
    const key = `OVER:${id}:TICKET`;
    // budget TICKET 0 → realisasi apa pun = over
    const e = await ctx.api('finance').post('/expenses', { clusterId: id, date: '2026-10-14', category: 'TICKET', description: 'Tiket uji', amount: '250000' }).expect(201);
    const pmList = await ctx.api('pm').get('/notifications').expect(200);
    const n = pmList.body.items.find((x: { key: string }) => x.key === key);
    expect(n).toMatchObject({ type: 'OVER_BUDGET', title: 'Over budget: SINDANG RW 01 MAJALENGKA' });
    expect(pmList.body.unread).toBeGreaterThan(0);
    const dir = await ctx.api('direktur').get('/notifications').expect(200);
    expect(dir.body.items.some((x: { key: string }) => x.key === key)).toBe(true);
    const fin = await ctx.api('finance').get('/notifications').expect(200);
    expect(fin.body.items.some((x: { key: string }) => x.key === key)).toBe(false);
    // rekap
    const rekap = await ctx.api('direktur').get('/budget/rekap').expect(200);
    expect(rekap.body.overBudget).toEqual(expect.arrayContaining([expect.objectContaining({ clusterId: id, code: 'TICKET', realisasi: '250000.00' })]));
    // tidak dobel saat expense lain masuk
    const e2 = await ctx.api('finance').post('/expenses', { clusterId: id, date: '2026-10-14', category: 'TICKET', description: 'Tiket uji 2', amount: '1000' }).expect(201);
    const recipients = await ctx.prisma.user.count({ where: { role: { in: ['PM', 'DIREKTUR'] }, active: true } });
    expect(await ctx.prisma.notification.count({ where: { key } })).toBe(recipients);
    // tandai dibaca
    await ctx.api('pm').post(`/notifications/${n.id}/read`).expect(201);
    await ctx.api('direktur').post(`/notifications/${n.id}/read`).expect(404);
    // hapus expense → re-arm
    await ctx.api('finance').del(`/expenses/${e.body.id}`).expect(200);
    await ctx.api('finance').del(`/expenses/${e2.body.id}`).expect(200);
    expect(await ctx.prisma.notification.count({ where: { key } })).toBe(0);
  });

  it('ambang dari Setting (realisasiOverPct)', async () => {
    const g = await ctx.api('admin').get('/settings/global').expect(200);
    expect(g.body.realisasiOverPct).toBe('1');
  });
});

describe('Termin klien: tanggal invoice belum diisi + referensi tagihan RAB', () => {
  it('inbox FINANCE menghitung termin tanpa tanggal invoice (Semarang permit, SND Kalawiran)', async () => {
    const res = await ctx.api('finance').get('/inbox/missing-invoice-dates').expect(200);
    const names = res.body.map((r: { clusterName: string; kind: string }) => `${r.clusterName}|${r.kind}`);
    expect(names).toEqual(expect.arrayContaining(['Padangsari RW 12 & 13 (Semarang)|PERMIT', 'Kalawiran Kakas Barat (Manado)|SND']));
    await ctx.api('pm').get('/inbox/missing-invoice-dates').expect(403);
  });

  it('terapkan referensi: bruto dari FINANCE, paidAmount = net referensi, potongan → PAJAK; tidak bisa dua kali', async () => {
    const id = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Kersanagara RW 08 Tasik');
    const c = await cluster(id);
    const ref = await ctx.prisma.clientInvoiceRef.create({
      data: { sourceRef: 'UJI:REF-1', projectId: c.projectId, clusterId: id, blockTitle: 'uji', termin: 1, invoiceNo: 'I-UJI-001', netAmount: '980000', dueDate: new Date('2026-10-20T00:00:00Z'), statusText: 'Paid', paid: true },
    });
    const list = await ctx.api('finance').get(`/clusters/${id}/client-payments`).expect(200);
    expect(list.body.invoiceRefs.map((r: { invoiceNo: string }) => r.invoiceNo)).toContain('I-UJI-001');
    const t1 = list.body.payments.find((p: { kind: string; termin: number }) => p.kind === 'IMPLEMENTASI' && p.termin === 1);
    await ctx.api('pm').post(`/client-payments/${t1.id}/apply-reference`, { refId: ref.id, amount: '1000000' }).expect(403);
    await ctx.api('finance').post(`/client-payments/${t1.id}/apply-reference`, { refId: ref.id, amount: '900000' }).expect(400);
    const res = await ctx.api('finance').post(`/client-payments/${t1.id}/apply-reference`, { refId: ref.id, amount: '1000000', paidDate: '2026-10-14' }).expect(201);
    expect(res.body).toMatchObject({ amount: '1000000', paidAmount: '980000', status: 'PAID', invoiceNo: 'I-UJI-001', potongan: '20000.00' });
    const tax = await ctx.prisma.expense.findUniqueOrThrow({ where: { sourceRef: `CLIENT_PAYMENT:${t1.id}` } });
    expect(tax).toMatchObject({ category: 'PAJAK' });
    expect(tax.amount.toString()).toBe('20000');
    await ctx.api('finance').post(`/client-payments/${t1.id}/apply-reference`, { refId: ref.id, amount: '1000000' }).expect(409);
    // kembalikan termin
    await ctx.api('finance').patch(`/client-payments/${t1.id}`, { amount: t1.amount, invoiceNo: null, invoiceDate: null, paidDate: null, paidAmount: null, dueDate: null }).expect(200);
    await ctx.prisma.clientInvoiceRef.delete({ where: { id: ref.id } });
    expect(await ctx.prisma.expense.findUnique({ where: { sourceRef: `CLIENT_PAYMENT:${t1.id}` } })).toBeNull();
  });
});

describe('Import penyesuaian PO ADW (baris "Deduction Termin 1 + Addwork")', () => {
  function upload(mode: 'dry-run' | 'commit', who: 'pm' | 'finance' = 'pm') {
    const { srv, auth } = ctx.api(who).raw();
    return srv.post(`/api/import/po-adjustments-xlsx?mode=${mode}`).set(auth).attach('file', readFileSync(RAB), 'RAB.xlsx');
  }

  it('dry-run → 8 baris ADDWORK/DEDUCTION, nilai PO sekarang → sesudah; commit → PO; ulang = UNCHANGED', async () => {
    const dry = await upload('dry-run').expect(200);
    expect(dry.body.summary).toEqual({ NEW: 8, CHANGED: 0, UNCHANGED: 0, NO_CLUSTER: 0 });
    const bat = await clusterId(ctx.prisma, 'ADW', 'Batumpang Rw 5 & 6 Purwakarta');
    const before = (await cluster(bat)).nilaiPoImpl.toString();
    const row = dry.body.clusters.find((c: { clusterId: string }) => c.clusterId === bat);
    expect(row.nilaiPoImplAfter).toBe(moneyStr(sum([before, '-755900'])));
    const res = await upload('commit').expect(200);
    expect(res.body).toMatchObject({ created: 8, updated: 0 });
    expect((await cluster(bat)).nilaiPoImpl.toString()).toBe(sum([before, '-755900']).toString());
    const tepas = await clusterId(ctx.prisma, 'ADW', 'Distribusi - TEPAS RW 05 NGAWI -REV');
    const pos = await ctx.prisma.clusterPo.findMany({ where: { clusterId: tepas, kind: { in: ['ADDWORK', 'DEDUCTION'] } }, orderBy: { sourceRef: 'asc' } });
    expect(pos.map((p) => [p.kind, p.amount.toString()])).toEqual([['ADDWORK', '398300'], ['DEDUCTION', '-730800']]);
    const again = await upload('dry-run').expect(200);
    expect(again.body.summary).toMatchObject({ NEW: 0, CHANGED: 0, UNCHANGED: 8 });
    // bersihkan untuk spec lain (acuan C memakai nilai PO asli)
    const created = await ctx.prisma.clusterPo.findMany({ where: { sourceRef: { startsWith: 'RAB:ADW!' } } });
    for (const p of created) await ctx.api('pm').del(`/clusters/pos/${p.id}`).expect(200);
    expect((await cluster(bat)).nilaiPoImpl.toString()).toBe(before);
    await ctx.prisma.fieldOverride.deleteMany({ where: { field: 'nilaiPoImpl', entityId: { in: created.map((p) => p.clusterId) } } });
  });

  it('FINANCE tidak boleh import penyesuaian PO', async () => {
    const { srv, auth } = ctx.api('finance').raw();
    await srv.post('/api/import/po-adjustments-xlsx').set(auth).attach('file', Buffer.from('x'), 'RAB.xlsx').expect(403);
  });
});
