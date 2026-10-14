import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { dec, moneyStr, sum, todayJakartaIso } from '@indotek/shared';
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

  it('ADDWORK & DEDUCTION: nilaiPoImpl = Σ IMPLEMENTASI + ADDWORK + DEDUCTION; tidak punya termin sendiri; validasi tanda', async () => {
    const id = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 02 SUBANG');
    const before = (await cluster(id)).nilaiPoImpl.toString();
    await ctx.api('finance').post(`/clusters/${id}/pos`, { kind: 'ADDWORK', amount: '100000' }).expect(403);
    await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'DEDUCTION', amount: '50000' }).expect(400);
    await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'ADDWORK', amount: '-1' }).expect(400);
    const add = await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'ADDWORK', poNumber: 'ADD-UJI', amount: '400000' }).expect(201);
    const ded = await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'DEDUCTION', amount: '-150000', note: 'uji' }).expect(201);
    expect((await cluster(id)).nilaiPoImpl.toString()).toBe(moneyStr(sum([before, '400000', '-150000'])).replace(/\.00$/, ''));
    const t = await ctx.api('finance').get(`/clusters/${id}/client-payments`).expect(200);
    expect(t.body.payments.filter((p: { poId: string }) => p.poId === add.body.id || p.poId === ded.body.id)).toEqual([]);
    // audit: PO + nilai cluster lama → baru; field ditandai diedit di aplikasi
    expect(await ctx.prisma.auditLog.count({ where: { entity: 'ClusterPo', entityId: add.body.id } })).toBeGreaterThan(0);
    const log = await ctx.prisma.auditLog.findFirst({ where: { entity: 'Cluster', entityId: id, field: 'nilaiPoImpl' }, orderBy: { at: 'desc' } });
    expect(log?.oldValue).toBeTruthy();
    expect(await ctx.prisma.fieldOverride.findUnique({ where: { entity_entityId_field: { entity: 'Cluster', entityId: id, field: 'nilaiPoImpl' } } })).not.toBeNull();
    await ctx.api('pm').del(`/clusters/pos/${add.body.id}`).expect(200);
    await ctx.api('pm').del(`/clusters/pos/${ded.body.id}`).expect(200);
    expect((await cluster(id)).nilaiPoImpl.toString()).toBe(before);
    await ctx.prisma.fieldOverride.deleteMany({ where: { entityId: id } });
  });

  it('Acuan R — koreksi addwork/deduction masuk TERMIN 1 (80% × PO dasar + Σ koreksi); termin 1 ditagih → termin berikutnya + peringatan; termin terpisah 2.3 dihapus', async () => {
    const id = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 02 SUBANG');
    const impl = await ctx.prisma.clusterPo.findFirstOrThrow({ where: { clusterId: id, kind: 'IMPLEMENTASI' } });
    const base = impl.amount.toString(); // 13.949.300
    const add = await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'ADDWORK', amount: '400000' }).expect(201);
    const ded = await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'DEDUCTION', amount: '-150000' }).expect(201);
    // simulasi termin terpisah gaya Fase 2.3 → harus dihapus saat hitung ulang
    const legacy = await ctx.prisma.clientPayment.create({ data: { clusterId: id, poId: add.body.id, kind: 'ADDWORK', termin: 1, pct: '1', amount: '400000', fromTemplate: false } });
    const prev = await ctx.api('finance').get(`/clusters/${id}/client-payments/recalculate`).expect(200);
    const k = prev.body.kinds.find((x: { kind: string }) => x.kind === 'IMPLEMENTASI');
    expect(k.adjustment).toBe('250000.00');
    const t1 = k.diffs.find((d: { termin: number }) => d.termin === 1);
    expect(t1.newAmount).toBe(moneyStr(sum([dec(base).times('0.8').toString(), '250000'])));
    expect(k.target).toBe(moneyStr(sum([base, '250000'])));
    const del = prev.body.kinds.find((x: { kind: string }) => x.kind === 'ADDWORK');
    expect(del.diffs).toEqual([expect.objectContaining({ id: legacy.id, deleted: true })]);
    await ctx.api('finance').post(`/clusters/${id}/client-payments/recalculate`).expect(200);
    expect(await ctx.prisma.clientPayment.findUnique({ where: { id: legacy.id } })).toBeNull();
    const rows = await ctx.prisma.clientPayment.findMany({ where: { poId: impl.id }, orderBy: { termin: 'asc' } });
    expect(rows[0].amount.toFixed(2)).toBe(t1.newAmount);
    expect(moneyStr(sum(rows.map((r) => r.amount.toString())))).toBe(moneyStr(sum([base, '250000'])));

    // termin 1 sudah ditagih → koreksi berikutnya masuk termin 2 + peringatan
    await ctx.api('finance').patch(`/client-payments/${rows[0].id}`, { invoiceDate: '2026-10-01' }).expect(200);
    const add2 = await ctx.api('pm').post(`/clusters/${id}/pos`, { kind: 'ADDWORK', amount: '100000' }).expect(201);
    const prev2 = await ctx.api('finance').get(`/clusters/${id}/client-payments/recalculate`).expect(200);
    const k2 = prev2.body.kinds.find((x: { kind: string }) => x.kind === 'IMPLEMENTASI');
    expect(k2.warning).toMatch(/Termin 1 sudah ditagih — koreksi addwork\/deduction Rp 350000.00 masuk ke termin 2/);
    expect(k2.diffs.find((d: { termin: number }) => d.termin === 1)).toMatchObject({ status: 'INVOICED', changed: false });
    expect(k2.diffs.find((d: { termin: number }) => d.termin === 2).newAmount).toBe(moneyStr(sum([dec(base).times('0.1').toString(), '350000'])));

    // bersihkan
    for (const po of [add, ded, add2]) await ctx.api('pm').del(`/clusters/pos/${po.body.id}`).expect(200);
    await ctx.api('finance').patch(`/client-payments/${rows[0].id}`, { invoiceDate: null }).expect(200);
    await ctx.api('finance').post(`/clusters/${id}/client-payments/recalculate`).expect(200);
    const back = await ctx.prisma.clientPayment.findMany({ where: { poId: impl.id }, orderBy: { termin: 'asc' } });
    expect(moneyStr(sum(back.map((r) => r.amount.toString())))).toBe(moneyStr(base));
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
  const expense = (clusterId: string, category: string, amount: string) =>
    ctx.api('finance').post('/expenses', { clusterId, date: '2026-10-14', category, description: `Uji over ${category}`, amount }).expect(201);
  const recipients = () => ctx.prisma.user.count({ where: { role: { in: ['PM', 'DIREKTUR'] }, active: true } });

  it('pos > ambang → tidak langsung, masuk "Ringkasan harian" (1 per user per hari, pos baru ditambahkan); Rekap memuat pos', async () => {
    const id = await clusterId(ctx.prisma, 'ADW', 'SINDANG RW 01 MAJALENGKA');
    const digestKey = `DIGEST:${todayJakartaIso()}`;
    // budget TICKET 0 → realisasi apa pun = over
    const e = await expense(id, 'TICKET', '250000');
    expect(await ctx.prisma.notification.count({ where: { key: { startsWith: `OVER:${id}:` } } })).toBe(0);
    const pm = await ctx.api('pm').get('/notifications').expect(200);
    const digest = pm.body.items.find((x: { key: string }) => x.key === digestKey);
    expect(digest).toMatchObject({ type: 'OVER_BUDGET_DIGEST', link: '/rekap' });
    expect(digest.title).toMatch(/^Ringkasan harian over budget/);
    expect(digest.body).toContain('SINDANG RW 01 MAJALENGKA — Ticket Internal: budget 0 (Rp 250.000 / Rp 0)');
    const fin = await ctx.api('finance').get('/notifications').expect(200);
    expect(fin.body.items.some((x: { key: string }) => x.key === digestKey)).toBe(false);
    // pos yang sama tidak diulang; pos baru ditambahkan ke ringkasan yang sama
    const e2 = await expense(id, 'TICKET', '1000');
    const e3 = await expense(id, 'MOTOR_MOBIL', '5000000');
    expect(await ctx.prisma.notification.count({ where: { key: digestKey } })).toBe(await recipients());
    const body = (await ctx.prisma.notification.findFirstOrThrow({ where: { key: digestKey } })).body;
    expect(body.match(/SINDANG RW 01 MAJALENGKA — Ticket Internal/g)).toHaveLength(1);
    expect(body).toContain('SINDANG RW 01 MAJALENGKA — Motor dan Mobil');
    const rekap = await ctx.api('direktur').get('/budget/rekap').expect(200);
    expect(rekap.body.overBudget).toEqual(expect.arrayContaining([expect.objectContaining({ clusterId: id, code: 'TICKET', realisasi: '251000.00' })]));
    await ctx.api('pm').post(`/notifications/${digest.id}/read`).expect(201);
    await ctx.api('direktur').post(`/notifications/${digest.id}/read`).expect(404);
    for (const x of [e, e2, e3]) await ctx.api('finance').del(`/expenses/${x.body.id}`).expect(200);
    // kembali di bawah ambang → status lintasan dilepas (riwayat notifikasi tetap)
    expect(await ctx.prisma.overrunState.count({ where: { clusterId: id, over: true, code: { in: ['TICKET', 'MOTOR_MOBIL'] } } })).toBe(0);
  });

  it('TOTAL cluster ≥ 100% → notifikasi langsung PM & DIREKTUR, sekali per lintasan ambang', async () => {
    const id = await clusterId(ctx.prisma, 'ADW', 'SINDANG RW 01 MAJALENGKA');
    const prefix = `OVER:${id}:TOTAL:`;
    const n = () => ctx.prisma.notification.count({ where: { key: { startsWith: prefix }, type: 'OVER_BUDGET' } });
    const big = await expense(id, 'SUBCON_JASA', '30000000');
    expect(await n()).toBe(await recipients());
    const pm = await ctx.api('pm').get('/notifications').expect(200);
    expect(pm.body.items.find((x: { key: string }) => x.key.startsWith(prefix)).body).toMatch(/^Total realisasi \d+,\d% dari budget/);
    const more = await expense(id, 'OPS', '100000');
    expect(await n()).toBe(await recipients()); // masih di atas ambang → tidak berulang
    await ctx.api('finance').del(`/expenses/${big.body.id}`).expect(200);
    const again = await expense(id, 'SUBCON_JASA', '30000000');
    expect(await n()).toBe(2 * (await recipients())); // lintasan kedua
    for (const x of [more, again]) await ctx.api('finance').del(`/expenses/${x.body.id}`).expect(200);
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

  it('terapkan referensi: DPP dari FINANCE, paidAmount = net referensi, potongan (DPP + PPN − net) → PAJAK; tidak bisa dua kali', async () => {
    const id = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Kersanagara RW 08 Tasik');
    const c = await cluster(id);
    const ref = await ctx.prisma.clientInvoiceRef.create({
      data: { sourceRef: 'UJI:REF-1', projectId: c.projectId, clusterId: id, blockTitle: 'uji', termin: 1, invoiceNo: 'I-UJI-001', netAmount: '980000', dueDate: new Date('2026-10-20T00:00:00Z'), statusText: 'Paid', paid: true },
    });
    const list = await ctx.api('finance').get(`/clusters/${id}/client-payments`).expect(200);
    expect(list.body.invoiceRefs.map((r: { invoiceNo: string }) => r.invoiceNo)).toContain('I-UJI-001');
    const t1 = list.body.payments.find((p: { kind: string; termin: number }) => p.kind === 'IMPLEMENTASI' && p.termin === 1);
    await ctx.api('pm').post(`/client-payments/${t1.id}/apply-reference`, { refId: ref.id, amount: '1000000' }).expect(403);
    // net 980.000 > tagihan DPP 800.000 + PPN 88.000 → ditolak
    await ctx.api('finance').post(`/client-payments/${t1.id}/apply-reference`, { refId: ref.id, amount: '800000' }).expect(400);
    const res = await ctx.api('finance').post(`/client-payments/${t1.id}/apply-reference`, { refId: ref.id, amount: '1000000', paidDate: '2026-10-14' }).expect(201);
    expect(res.body).toMatchObject({ amount: '1000000', ppnAmount: '110000.00', invoiceTotal: '1110000.00', paidAmount: '980000', status: 'PAID', invoiceNo: 'I-UJI-001', potongan: '130000.00' });
    const tax = await ctx.prisma.expense.findUniqueOrThrow({ where: { sourceRef: `CLIENT_PAYMENT:${t1.id}` } });
    expect(tax).toMatchObject({ category: 'PAJAK' });
    expect(tax.amount.toString()).toBe('130000');
    await ctx.api('finance').post(`/client-payments/${t1.id}/apply-reference`, { refId: ref.id, amount: '1000000' }).expect(409);
    // kembalikan termin
    await ctx.api('finance').patch(`/client-payments/${t1.id}`, { amount: t1.amount, invoiceNo: null, invoiceDate: null, paidDate: null, paidAmount: null, dueDate: null }).expect(200);
    await ctx.prisma.clientInvoiceRef.delete({ where: { id: ref.id } });
    expect(await ctx.prisma.expense.findUnique({ where: { sourceRef: `CLIENT_PAYMENT:${t1.id}` } })).toBeNull();
  });
});

describe('Acuan Q — PPN termin klien & pencocokan referensi RAB (Fase 2.4)', () => {
  it('Sinagar permit termin 1: expectedNet 20.044.750 → referensi cocok otomatis (usulan), dikonfirmasi FINANCE → PAJAK 490.250, PPN titipan 2.035.000', async () => {
    const sinagar = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Sinagar Tasik');
    const c = await cluster(sinagar);
    let list = await ctx.api('finance').get(`/clusters/${sinagar}/client-payments`).expect(200);
    const ppnBefore = list.body.totals.ppnTitipan as string;
    const permit1 = list.body.payments.find((p: { kind: string; termin: number }) => p.kind === 'PERMIT' && p.termin === 1);
    expect(permit1).toMatchObject({ amount: '18500000', ppnRate: '0.11', pphRate: '0.0265', ppnAmount: '2035000.00', pphAmount: '490250.00', invoiceTotal: '20535000.00', expectedNet: '20044750.00' });
    const existing = await ctx.prisma.clientInvoiceRef.findFirst({ where: { invoiceNo: 'I2628-00139' } });
    const ref =
      existing ??
      (await ctx.prisma.clientInvoiceRef.create({
        data: { sourceRef: 'UJI:I2628-00139', projectId: c.projectId, clusterId: sinagar, blockTitle: 'Cluster Sinagar Tasik - Permit', termin: 1, invoiceNo: 'I2628-00139', netAmount: '20044750', statusText: 'Paid', paid: true },
      }));
    list = await ctx.api('finance').get(`/clusters/${sinagar}/client-payments`).expect(200);
    const r = list.body.invoiceRefs.find((x: { id: string }) => x.id === ref.id);
    expect(r.suggestion).toMatchObject({ paymentId: permit1.id, kind: 'PERMIT', termin: 1, expectedNet: '20044750.00', selisih: '0.00' });
    // usulan saja — belum diterapkan
    expect((await ctx.prisma.clientPayment.findUniqueOrThrow({ where: { id: permit1.id } })).status).not.toBe('PAID');
    await ctx.api('pm').post(`/clusters/${sinagar}/client-payments/apply-matched`, { refIds: [ref.id] }).expect(403);
    const res = await ctx.api('finance').post(`/clusters/${sinagar}/client-payments/apply-matched`, { refIds: [ref.id], paidDate: '2026-09-30' }).expect(201);
    expect(res.body.applied).toEqual([expect.objectContaining({ refId: ref.id, paymentId: permit1.id })]);
    const after = await ctx.prisma.clientPayment.findUniqueOrThrow({ where: { id: permit1.id } });
    expect(after.status).toBe('PAID');
    expect(after.amount.toString()).toBe('18500000');
    expect(after.paidAmount!.toString()).toBe('20044750');
    const tax = await ctx.prisma.expense.findUniqueOrThrow({ where: { sourceRef: `CLIENT_PAYMENT:${permit1.id}` } });
    expect(tax.amount.toString()).toBe('490250');
    list = await ctx.api('finance').get(`/clusters/${sinagar}/client-payments`).expect(200);
    expect(list.body.totals.ppnTitipan).toBe(moneyStr(sum([ppnBefore, '2035000'])));
    const real = await ctx.api('finance').get(`/clusters/${sinagar}/realization`).expect(200);
    expect(real.body.profit.ppnTitipan).toBe(moneyStr(sum([ppnBefore, '2035000'])));
    // kembalikan
    await ctx.prisma.clientInvoiceRef.update({ where: { id: ref.id }, data: { appliedPaymentId: null, appliedAt: null, appliedById: null } });
    await ctx.api('finance').patch(`/client-payments/${permit1.id}`, { invoiceNo: null, paidDate: null, paidAmount: null }).expect(200);
    if (!existing) await ctx.prisma.clientInvoiceRef.delete({ where: { id: ref.id } });
  });

  it('referensi Paid tanpa tanggal: status Dibayar, tanggal diterima kosong → badge & inbox FINANCE', async () => {
    const id = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Kersanagara RW 04 Tasik');
    const c = await cluster(id);
    const list = await ctx.api('finance').get(`/clusters/${id}/client-payments`).expect(200);
    const t = list.body.payments.find((p: { kind: string; termin: number }) => p.kind === 'PERMIT' && p.termin === 2);
    const ref = await ctx.prisma.clientInvoiceRef.create({
      data: { sourceRef: 'UJI:REF-NODATE', projectId: c.projectId, clusterId: id, termin: 2, invoiceNo: 'I-UJI-ND', netAmount: t.expectedNet, statusText: 'Paid', paid: true },
    });
    await ctx.api('finance').post(`/clusters/${id}/client-payments/apply-matched`, { refIds: [ref.id] }).expect(201);
    const row = (await ctx.api('finance').get(`/clusters/${id}/client-payments`).expect(200)).body.payments.find((p: { id: string }) => p.id === t.id);
    expect(row).toMatchObject({ status: 'PAID', paidDate: null, needsPaidDate: true });
    const inbox = await ctx.api('finance').get('/inbox/missing-invoice-dates').expect(200);
    expect(inbox.body.find((x: { id: string }) => x.id === t.id)).toMatchObject({ missing: 'PAID' });
    await ctx.prisma.clientInvoiceRef.update({ where: { id: ref.id }, data: { appliedPaymentId: null } });
    await ctx.api('finance').patch(`/client-payments/${t.id}`, { invoiceNo: null, paidAmount: null, paidDate: null }).expect(200);
    await ctx.prisma.clientInvoiceRef.delete({ where: { id: ref.id } });
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

describe('Perbaikan 2.4 — PPN per client, pencocokan "cocok di DPP", pembayaran klien belum lengkap', () => {
  it('PPN per client (ADMIN) meng-override global untuk termin baru; diaudit', async () => {
    const ccsi = await ctx.prisma.client.findUniqueOrThrow({ where: { name: 'CCSI' } });
    const original = ccsi.ppnRate?.toString() ?? null;
    await ctx.api('pm').patch(`/clients/${ccsi.id}/ppn`, { ppnRate: '0' }).expect(403);
    await ctx.api('admin').patch(`/clients/${ccsi.id}/ppn`, { ppnRate: '0', reason: 'uji' }).expect(200);
    const sem = await clusterId(ctx.prisma, 'CCSI', 'Padangsari RW 12 & 13 (Semarang)');
    const po = await ctx.prisma.clusterPo.findFirstOrThrow({ where: { clusterId: sem, kind: 'PERMIT' } });
    const t = await ctx.api('finance').post(`/clusters/${sem}/client-payments`, { poId: po.id, kind: 'PERMIT', termin: 9, amount: '1000' }).expect(201);
    expect(t.body).toMatchObject({ ppnRate: '0', ppnAmount: '0.00' });
    const log = await ctx.prisma.auditLog.findFirst({ where: { entity: 'Client', entityId: ccsi.id, field: 'alasan' }, orderBy: { at: 'desc' } });
    expect(log?.newValue).toBe('uji');
    await ctx.api('finance').del(`/client-payments/${t.body.id}`).expect(200);
    await ctx.api('admin').patch(`/clients/${ccsi.id}/ppn`, { ppnRate: original }).expect(200);
  });

  it('nilai referensi per client: EVANTAMA = NET untuk semua status (Unpaid → INVOICED); referensi = DPP termin → "cocok di DPP" (perlu konfirmasi pajak)', async () => {
    const ev = await ctx.prisma.client.findUniqueOrThrow({ where: { name: 'PT Evantama Network System' } });
    expect(ev.referenceValueType).toBe('NET');
    await ctx.api('finance').patch(`/clients/${ev.id}/reference-value-type`, { referenceValueType: 'INVOICE_TOTAL' }).expect(403);
    const rw04 = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Kersanagara RW 04 Tasik');
    const c = await cluster(rw04);
    const list0 = await ctx.api('finance').get(`/clusters/${rw04}/client-payments`).expect(200);
    const t1 = list0.body.payments.find((p: { kind: string; termin: number }) => p.kind === 'PERMIT' && p.termin === 1);
    // DPP 2.500.000 (50% × 5.000.000), PPN 11% → tagihan 2.775.000
    const dpp = await ctx.prisma.clientInvoiceRef.create({
      data: { sourceRef: 'UJI:DPP', projectId: c.projectId, clusterId: rw04, termin: 1, invoiceNo: 'INV-UJI-DPP', netAmount: t1.amount, statusText: 'Unpaid', paid: false },
    });
    let list = await ctx.api('finance').get(`/clusters/${rw04}/client-payments`).expect(200);
    expect(list.body.invoiceRefs.find((x: { id: string }) => x.id === dpp.id).suggestion).toMatchObject({ mode: 'DPP', basis: 'DPP', perluKonfirmasiPajak: true, paymentId: t1.id });
    const res = await ctx.api('finance').post(`/clusters/${rw04}/client-payments/apply-matched`, { refIds: [dpp.id] }).expect(201);
    expect(res.body.applied).toEqual([]);
    await ctx.prisma.clientInvoiceRef.delete({ where: { id: dpp.id } });
    // tagihan DPP + PPN tidak cocok untuk client NET
    const tagihan = await ctx.prisma.clientInvoiceRef.create({
      data: { sourceRef: 'UJI:TAGIHAN', projectId: c.projectId, clusterId: rw04, termin: 1, invoiceNo: 'INV-UJI-TAG', netAmount: t1.invoiceTotal, statusText: 'Unpaid', paid: false },
    });
    list = await ctx.api('finance').get(`/clusters/${rw04}/client-payments`).expect(200);
    expect(list.body.invoiceRefs.find((x: { id: string }) => x.id === tagihan.id).suggestion).toBeNull();
    await ctx.prisma.clientInvoiceRef.delete({ where: { id: tagihan.id } });
    // Unpaid = net DPP + PPN − PPh → cocok (NET) → diterapkan sebagai INVOICED
    const inv = await ctx.prisma.clientInvoiceRef.create({
      data: { sourceRef: 'UJI:INV', projectId: c.projectId, clusterId: rw04, termin: 1, invoiceNo: 'INV-UJI-INV', netAmount: t1.expectedNet, statusText: 'Unpaid', paid: false },
    });
    list = await ctx.api('finance').get(`/clusters/${rw04}/client-payments`).expect(200);
    expect(list.body.invoiceRefs.find((x: { id: string }) => x.id === inv.id).suggestion).toMatchObject({ mode: 'NET', basis: 'NET', paymentId: t1.id });
    await ctx.api('finance').post(`/clusters/${rw04}/client-payments/apply-matched`, { refIds: [inv.id] }).expect(201);
    expect((await ctx.prisma.clientPayment.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('INVOICED');
    await ctx.prisma.clientInvoiceRef.update({ where: { id: inv.id }, data: { appliedPaymentId: null } });
    await ctx.api('finance').patch(`/client-payments/${t1.id}`, { invoiceNo: null }).expect(200);
    await ctx.prisma.clientPayment.update({ where: { id: t1.id }, data: { status: 'UNBILLED' } });
    await ctx.prisma.clientInvoiceRef.delete({ where: { id: inv.id } });
  });

  it('CCSI: PPN 0 (client), template implementasi 30/30/30/10 per PO, termin 4 retensi 3 bulan dari opname; referensi tanpa nomor termin → termin terkecil', async () => {
    const ccsi = await ctx.prisma.client.findUniqueOrThrow({ where: { name: 'CCSI' } });
    expect(ccsi.ppnRate?.toString()).toBe('0');
    const kal = await clusterId(ctx.prisma, 'CCSI', 'Kalawiran Kakas Barat (Manado)');
    const list = await ctx.api('finance').get(`/clusters/${kal}/client-payments`).expect(200);
    const impl = list.body.payments.filter((p: { kind: string }) => p.kind === 'IMPLEMENTASI');
    expect(impl.map((p: { pct: string; amount: string; ppnRate: string }) => [p.pct, p.amount, p.ppnRate])).toEqual([
      ['0.3', '16325968.8', '0'],
      ['0.3', '16325968.8', '0'],
      ['0.3', '16325968.8', '0'],
      ['0.1', '5441989.6', '0'],
    ]);
    expect(impl[3].retentionMonths).toBe(3);
    const t4 = await ctx.api('finance').patch(`/client-payments/${impl[3].id}`, { opnameDate: '2026-11-30' }).expect(200);
    expect(t4.body).toMatchObject({ opnameDate: '2026-11-30', retentionReleaseDate: '2027-02-28' });
    await ctx.api('finance').patch(`/client-payments/${impl[3].id}`, { opnameDate: null }).expect(200);
    // referensi project-level tanpa nomor termin = 30% → cocok termin 1 (bukan ganda)
    const c = await cluster(kal);
    const ref = await ctx.prisma.clientInvoiceRef.create({
      data: { sourceRef: 'UJI:CCSI-004', projectId: c.projectId, clusterId: null, invoiceNo: 'INV-UJI-004', netAmount: '16325969', statusText: 'Unpaid', paid: false },
    });
    const l2 = await ctx.api('finance').get(`/clusters/${kal}/client-payments`).expect(200);
    // termin terkecil yang belum diambil referensi lain (INV-RAA/004 asli bisa sudah mengambil termin 1 bila RAB diimpor lebih dulu)
    const takenByOthers = new Set(
      l2.body.invoiceRefs
        .filter((x: { id: string }) => x.id !== ref.id)
        .map((x: { suggestion: { paymentId: string } | null; appliedPaymentId: string | null }) => x.suggestion?.paymentId ?? x.appliedPaymentId)
        .filter(Boolean),
    );
    const expected = impl.slice(0, 3).find((p: { id: string; status: string }) => !takenByOthers.has(p.id) && p.status !== 'PAID');
    expect(l2.body.invoiceRefs.find((x: { id: string }) => x.id === ref.id).suggestion).toMatchObject({ mode: 'NET', basis: 'INVOICE_TOTAL', paymentId: expected.id, termin: expected.termin });
    await ctx.prisma.clientInvoiceRef.delete({ where: { id: ref.id } });
  });

  it('pembayaran klien belum lengkap: UNBILLED cluster DONE / implementasi > 30 hari + termin ditagih tanpa tanggal; khusus FINANCE/ADMIN/DIREKTUR', async () => {
    await ctx.api('pm').get('/client-payments/incomplete').expect(403);
    const kal = await clusterId(ctx.prisma, 'CCSI', 'Kalawiran Kakas Barat (Manado)');
    let res = await ctx.api('finance').get('/client-payments/incomplete').expect(200);
    const ccsi = res.body.find((g: { projectCode: string }) => g.projectCode === 'CCSI');
    const snd = ccsi.items.find((i: { clusterId: string; kind: string }) => i.clusterId === kal && i.kind === 'SND');
    expect(snd.reasons).toContain('tanggal invoice belum diisi');
    // cluster DONE → termin UNBILLED ikut
    const wan = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 02 SUBANG');
    const before = (await cluster(wan)).status;
    await ctx.prisma.cluster.update({ where: { id: wan }, data: { status: 'DONE' } });
    res = await ctx.api('finance').get(`/client-payments/incomplete?projectId=${(await cluster(wan)).projectId}`).expect(200);
    const adw = res.body[0];
    expect(adw.projectCode).toBe('ADW');
    expect(adw.items.filter((i: { clusterId: string }) => i.clusterId === wan).map((i: { reasons: string[] }) => i.reasons[0])).toEqual(
      expect.arrayContaining(['cluster selesai, termin belum ditagih']),
    );
    await ctx.prisma.cluster.update({ where: { id: wan }, data: { status: before } });
  });
});
