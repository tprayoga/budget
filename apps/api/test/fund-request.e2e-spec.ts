import request from 'supertest';
import { binaryParser, clusterId, createApp } from './helpers';

let ctx: Awaited<ReturnType<typeof createApp>>;
let wanasari: string;

beforeAll(async () => {
  ctx = await createApp();
  wanasari = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 01 SUBANG');
});
afterAll(async () => {
  await ctx.app.close();
});

const ALL = ['SUBCON', 'PERMIT', 'TICKET', 'PAJAK', 'INDIRECT', 'DIRECT', 'OPS_KANTOR', 'MOTOR_MOBIL', 'HOMEBASE', 'ALLOWANCE', 'MARKETING'];
const pct = (p: string) => ALL.map((budgetCode) => ({ budgetCode, pctCair: p }));
const line = (fr: { lines: { budgetCode: string }[] }, code: string) =>
  fr.lines.find((l) => l.budgetCode === code) as Record<string, string>;

async function approveAll(id: string) {
  await ctx.api('finance').post(`/fund-requests/${id}/approve`, { note: 'OK' }).expect(200);
  await ctx.api('direktur').post(`/fund-requests/${id}/approve`).expect(200);
  await ctx.api('investor').post(`/fund-requests/${id}/approve`).expect(200);
}

function disburse(id: string, tanggal = '2026-10-15') {
  const { srv } = ctx.api('finance').raw();
  return request(srv)
    .post(`/api/fund-requests/${id}/disburse`)
    .set(ctx.api('finance').raw().auth)
    .field('cairTanggal', tanggal)
    .attach('file', Buffer.from('%PDF-1.4 bukti'), { filename: 'bukti.pdf', contentType: 'application/pdf' });
}

describe('Acceptance A — form pengajuan 100% lewat API', () => {
  it('draft: total 7.708.170, terbilang, info pendukung, label DRAFT, rekening default', async () => {
    const res = await ctx.api('pm').post('/fund-requests', { clusterId: wanasari, tanggal: '2026-10-13' }).expect(201);
    const fr = res.body;
    expect(fr.status).toBe('DRAFT');
    expect(fr.number).toBeNull();
    expect(fr.label).toMatch(/^DRAFT-[A-Z0-9]{6}$/);
    expect(fr.total.diajukan).toBe('7708170.00');
    expect(fr.total.budgetAmount).toBe('7708168.00');
    expect(fr.terbilang).toBe('Tujuh juta tujuh ratus delapan ribu seratus tujuh puluh rupiah');
    expect(fr.snapshot).toMatchObject({
      nilaiProyek: '9440850.00',
      infoBunga: '865225.30',
      infoRetensi: '944085.00',
      infoProfit: '-76628.30',
      terminKe: 1,
    });
    expect(fr.justifikasi).toBe('Modal kerja pelaksanaan pekerjaan FTTH WANASARI RW 01 SUBANG untuk PT ADW.');
    expect(fr.rekeningBank).toBe('BCA');
    expect(fr.periode).toBe('Oktober 2026');
    expect(fr.allowedActions).toEqual(['SUBMIT']);
    await ctx.api('pm').del(`/fund-requests/${fr.id}`).expect(200);
  });
});

describe('Acceptance F — pencairan bertahap 50% + 50% + validasi sedangDiproses', () => {
  let fr1: string;
  let fr3: string;

  it('pengajuan #1 50% → submit → nomor FPD/ADW/2026/10/001', async () => {
    const res = await ctx.api('pm').post('/fund-requests', { clusterId: wanasari, tanggal: '2026-10-13', lines: pct('0.5') }).expect(201);
    fr1 = res.body.id;
    expect(res.body.total.diajukan).toBe('3854083.00');
    const sub = await ctx.api('pm').post(`/fund-requests/${fr1}/submit`).expect(200);
    expect(sub.body.number).toBe('FPD/ADW/2026/10/001');
    expect(sub.body.status).toBe('DIAJUKAN');
    expect(sub.body.terminKe).toBe(1);
    expect(sub.body.signatures.DIAJUKAN.name).toBe('Andi Pratama');
  });

  it('selama #1 diproses: pengajuan lain 100% ditolak (OVER_BUDGET), info sedangDiproses tampil', async () => {
    const res = await ctx.api('pm').post('/fund-requests', { clusterId: wanasari, tanggal: '2026-10-14' }).expect(201);
    expect(line(res.body, 'SUBCON').sedangDiproses).toBe('3476450.00');
    expect(line(res.body, 'SUBCON').sudahDicairkanSebelum).toBe('0.00');
    expect(res.body.overBudgetCodes).toContain('SUBCON');
    const sub = await ctx.api('pm').post(`/fund-requests/${res.body.id}/submit`).expect(409);
    expect(sub.body.code).toBe('OVER_BUDGET');
    // PM tidak bisa override; ADMIN bisa dengan alasan
    await ctx.api('pm').post(`/fund-requests/${res.body.id}/submit`, { override: true, overrideReason: 'x' }).expect(403);
    await ctx.api('pm').del(`/fund-requests/${res.body.id}`).expect(200);
  });

  it('approval sesuai role & urutan; role salah ditolak', async () => {
    await ctx.api('direktur').post(`/fund-requests/${fr1}/approve`).expect(403);
    await ctx.api('investor').post(`/fund-requests/${fr1}/approve`).expect(403);
    const inbox = await ctx.api('finance').get('/fund-requests/inbox').expect(200);
    expect(inbox.body.items.map((i: { id: string }) => i.id)).toContain(fr1);
    await approveAll(fr1);
    const d = await ctx.api('pm').get(`/fund-requests/${fr1}`).expect(200);
    expect(d.body.status).toBe('DIKETAHUI_INVESTOR');
    expect(d.body.signatures.PERIKSA_FINANCE.name).toBe('Siti Rahmawati');
    expect(d.body.signatures.SETUJU_DIREKTUR.name).toBe('Budi Santoso');
    expect(d.body.signatures.MENGETAHUI_INVESTOR.name).toBe('Hendra Wijaya');
  });

  it('pencairan wajib bukti; FINANCE tandai DICAIRKAN', async () => {
    await ctx.api('finance').post(`/fund-requests/${fr1}/disburse`, { cairTanggal: '2026-10-15' }).expect(400);
    const res = await disburse(fr1).expect(200);
    expect(res.body.status).toBe('DICAIRKAN');
    expect(res.body.cairTanggal).toBe('2026-10-15');
    expect(res.body.attachments.find((a: { kind: string }) => a.kind === 'BUKTI_CAIR')).toBeTruthy();
  });

  it('pengajuan #2 50%: terminKe 2, sudahDicairkanSebelum = #1, total 3.854.087, sisa 0', async () => {
    const res = await ctx.api('pm').post('/fund-requests', { clusterId: wanasari, tanggal: '2026-10-20', lines: pct('0.5') }).expect(201);
    fr3 = res.body.id;
    const fr = res.body;
    expect(fr.terminKe).toBe(2);
    expect(line(fr, 'SUBCON').sudahDicairkanSebelum).toBe('3476450.00');
    expect(line(fr, 'PAJAK').sudahDicairkanSebelum).toBe('118011.00');
    expect(line(fr, 'PAJAK').diajukan).toBe('118010.00');
    expect(line(fr, 'INDIRECT').diajukan).toBe('47205.00');
    expect(fr.total.sudahDicairkanSebelum).toBe('3854083.00');
    expect(fr.total.diajukan).toBe('3854087.00');
    expect(fr.lines.every((l: { sisaBudget: string }) => l.sisaBudget === '0.00')).toBe(true);
    const sub = await ctx.api('pm').post(`/fund-requests/${fr3}/submit`).expect(200);
    expect(sub.body.number).toBe('FPD/ADW/2026/10/002');
  });

  it('tolak → revisi → DRAFT → submit ulang memakai nomor lama', async () => {
    await ctx.api('finance').post(`/fund-requests/${fr3}/reject`, {}).expect(400); // alasan wajib
    const rej = await ctx.api('finance').post(`/fund-requests/${fr3}/reject`, { note: 'Lampiran kurang' }).expect(200);
    expect(rej.body.status).toBe('DITOLAK');
    expect(rej.body.rejectedNote).toBe('Lampiran kurang');
    const pmInbox = await ctx.api('pm').get('/fund-requests/inbox').expect(200);
    expect(pmInbox.body.items.map((i: { id: string }) => i.id)).toContain(fr3);
    const rev = await ctx.api('pm').post(`/fund-requests/${fr3}/revise`).expect(200);
    expect(rev.body.status).toBe('DRAFT');
    expect(rev.body.number).toBe('FPD/ADW/2026/10/002');
    await ctx.api('pm').patch(`/fund-requests/${fr3}`, { justifikasi: 'Termin pelunasan WANASARI RW 01.' }).expect(200);
    const sub = await ctx.api('pm').post(`/fund-requests/${fr3}/submit`).expect(200);
    expect(sub.body.number).toBe('FPD/ADW/2026/10/002');
    // tanda tangan hanya dari siklus terakhir
    expect(sub.body.signatures.PERIKSA_FINANCE).toBeNull();
    const seq = await ctx.prisma.fpdSequence.findMany();
    expect(seq.find((s) => s.month === 10)?.lastSeq).toBe(2);
  });

  it('snapshot dibekukan saat submit: perubahan setting/budget tidak mengubah pengajuan', async () => {
    await ctx.api('admin').put('/settings/global', { interestRate: '0.2' }).expect(200);
    await ctx.api('pm').put(`/clusters/${wanasari}/budget-lines`, [{ code: 'INDIRECT', mode: 'PCT', pct: '0.02' }]).expect(200);
    const frozen = await ctx.api('pm').get(`/fund-requests/${fr1}`).expect(200);
    expect(frozen.body.snapshot.interestRate).toBe('0.1');
    expect(frozen.body.snapshot.infoBunga).toBe('865225.3');
    expect(line(frozen.body, 'INDIRECT').budgetAmount).toBe('94408.50');
    // draft ikut berubah
    const draft = await ctx.api('pm').post('/fund-requests', { clusterId: wanasari, tanggal: '2026-10-21', lines: pct('0') }).expect(201);
    expect(draft.body.snapshot.interestRate).toBe('0.2');
    expect(line(draft.body, 'INDIRECT').budgetAmount).toBe('188817.00');
    await ctx.api('pm').del(`/fund-requests/${draft.body.id}`).expect(200);
    await ctx.api('admin').put('/settings/global', { interestRate: '0.10' }).expect(200);
    await ctx.api('pm').put(`/clusters/${wanasari}/budget-lines`, [{ code: 'INDIRECT', mode: 'PCT', pct: '0.01' }]).expect(200);
  });

  it('audit log mencatat perubahan pengajuan (status & angka)', async () => {
    const logs = await ctx.prisma.auditLog.findMany({ where: { entity: 'FundRequest', entityId: fr3 } });
    const fields = new Set(logs.map((l) => l.field));
    expect(fields).toContain('status');
    expect(fields).toContain('line.PAJAK.diajukan');
    expect(fields).toContain('justifikasi');
    expect(logs.find((l) => l.field === 'number')?.newValue).toBe('FPD/ADW/2026/10/002');
  });

  it('PDF dapat diunduh (A4)', async () => {
    const { srv, auth } = ctx.api('investor').raw();
    const res = await request(srv).get(`/api/fund-requests/${fr1}/pdf`).set(auth).buffer(true).parse(binaryParser).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  }, 60000);
});

describe('Row lock: dua submit bersamaan tidak boleh melebihi budget', () => {
  it('hanya satu dari dua pengajuan 60% yang lolos', async () => {
    const cid = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 02 SUBANG');
    const a = await ctx.api('pm').post('/fund-requests', { clusterId: cid, lines: pct('0.6') }).expect(201);
    const b = await ctx.api('pm').post('/fund-requests', { clusterId: cid, lines: pct('0.6') }).expect(201);
    const results = await Promise.all([
      ctx.api('pm').post(`/fund-requests/${a.body.id}/submit`),
      ctx.api('pm').post(`/fund-requests/${b.body.id}/submit`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('ADMIN override dengan alasan', async () => {
    const cid = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 02 SUBANG');
    const c = await ctx.api('admin').post('/fund-requests', { clusterId: cid, lines: pct('0.6') }).expect(201);
    await ctx.api('admin').post(`/fund-requests/${c.body.id}/submit`, { override: true }).expect(400);
    const ok = await ctx.api('admin')
      .post(`/fund-requests/${c.body.id}/submit`, { override: true, overrideReason: 'Addendum PO menunggu' })
      .expect(200);
    expect(ok.body.overrideReason).toBe('Addendum PO menunggu');
    // validasi saat approve tidak memblokir pengajuan yang di-override
    await ctx.api('finance').post(`/fund-requests/${c.body.id}/approve`).expect(200);
  });
});

describe('Validasi ulang saat approve', () => {
  it('approve ditolak bila pengajuan lain sudah memakai sisa budget', async () => {
    const cid = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 03 SUBANG');
    const a = await ctx.api('pm').post('/fund-requests', { clusterId: cid, lines: pct('0.7') }).expect(201);
    await ctx.api('pm').post(`/fund-requests/${a.body.id}/submit`).expect(200);
    // simulasikan data lama yang lolos tanpa validasi: pengajuan lain langsung berstatus DIAJUKAN
    const b = await ctx.api('pm').post('/fund-requests', { clusterId: cid, lines: pct('0.7') }).expect(201);
    await ctx.prisma.fundRequest.update({ where: { id: b.body.id }, data: { status: 'DIAJUKAN', number: 'FPD/ADW/2026/10/999' } });
    const res = await ctx.api('finance').post(`/fund-requests/${a.body.id}/approve`).expect(409);
    expect(res.body.code).toBe('OVER_BUDGET');
  });
});

describe('Akses INVESTOR ke pengajuan', () => {
  it('investor tidak melihat/approve pengajuan EVANTAMA', async () => {
    const cid = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Sinagar Tasik');
    const fr = await ctx.api('pm').post('/fund-requests', { clusterId: cid, lines: pct('0.1') }).expect(201);
    const sub = await ctx.api('pm').post(`/fund-requests/${fr.body.id}/submit`).expect(200);
    expect(sub.body.number).toMatch(/^FPD\/EVANTAMA\/\d{4}\/\d{2}\/001$/);
    await ctx.api('finance').post(`/fund-requests/${fr.body.id}/approve`).expect(200);
    await ctx.api('direktur').post(`/fund-requests/${fr.body.id}/approve`).expect(200);
    await ctx.api('investor').get(`/fund-requests/${fr.body.id}`).expect(404);
    await ctx.api('investor').post(`/fund-requests/${fr.body.id}/approve`).expect(404);
    const list = await ctx.api('investor').get('/fund-requests').expect(200);
    expect(list.body.every((f: { project: { code: string } }) => f.project.code === 'ADW')).toBe(true);
    const inbox = await ctx.api('investor').get('/fund-requests/inbox').expect(200);
    expect(inbox.body.items.find((i: { id: string }) => i.id === fr.body.id)).toBeUndefined();
  });

  it('export daftar pengajuan', async () => {
    const { srv, auth } = ctx.api('finance').raw();
    const res = await request(srv).get('/api/export/fund-requests.xlsx').set(auth).buffer(true).parse(binaryParser).expect(200);
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
  });
});
