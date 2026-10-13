import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dec } from '@indotek/shared';
import { parseBudgetWorkbook } from '@indotek/shared/xlsx';
import { binaryParser, clusterId, createApp } from './helpers';

const SAMPLE = path.resolve(__dirname, '../../../docs/samples/Budget_Per_Cluster_ADW_Evantama_CCSI.sample.xlsx');

let ctx: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  ctx = await createApp();
});
afterAll(async () => {
  await ctx.app.close();
});

const within1 = (actual: string, expected: string) => expect(dec(actual).minus(expected).abs().lte(1)).toBe(true);

describe('Acceptance C — total project setelah seed/import (lewat DB)', () => {
  it('rekap ADW / EVANTAMA / CCSI', async () => {
    const res = await ctx.api('admin').get('/budget/rekap').expect(200);
    const byCode = Object.fromEntries(res.body.projects.map((p: { project: { code: string } }) => [p.project.code, p]));
    expect(byCode.ADW.clusters).toHaveLength(30);
    within1(byCode.ADW.total.nilaiProyek, '716165700');
    within1(byCode.ADW.total.profit, '-7815037');
    within1(byCode.EVANTAMA.total.nilaiProyek, '236454823');
    within1(byCode.EVANTAMA.total.profit, '-12759106');
    within1(byCode.CCSI.total.nilaiProyek, '136073359');
    within1(byCode.CCSI.total.profit, '-1871953');
  });

  it('Acceptance A & D lewat GET /projects/:id/budget', async () => {
    const adw = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'ADW' } });
    const res = await ctx.api('pm').get(`/projects/${adw.id}/budget`).expect(200);
    const w = res.body.clusters.find((c: { name: string }) => c.name === 'WANASARI RW 01 SUBANG');
    expect(w.calc).toMatchObject({
      danaInvestor: '8652253.00',
      interest: '865225.30',
      outflow: '9517478.30',
      profit: '-76628.30',
    });
    expect(w.calc.pajak.amount).toBe('236021.25');

    const ev = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' } });
    const evRes = await ctx.api('pm').get(`/projects/${ev.id}/budget`).expect(200);
    const sinagar = evRes.body.clusters.find((c: { name: string }) => c.name === 'Cluster Sinagar Tasik');
    expect(sinagar.calc.nilaiProyek).toBe('145940677.00');
    expect(sinagar.calc.pajak.amount).toBe('3867427.94');
  });

  it('Acceptance B — preview what-if retensiAsCost=false tanpa menyimpan', async () => {
    const adw = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'ADW' } });
    const res = await ctx.api('direktur').get(`/projects/${adw.id}/budget?retensiAsCost=false`).expect(200);
    const w = res.body.clusters.find((c: { name: string }) => c.name === 'WANASARI RW 01 SUBANG');
    expect(w.calc).toMatchObject({ danaInvestor: '7708168.00', interest: '770816.80', profit: '961865.20' });
    const global = await ctx.api('direktur').get('/settings/global').expect(200);
    expect(global.body.retensiAsCost).toBe(true);
  });
});

describe('Setting global — hanya ADMIN, tercatat di audit', () => {
  it('PM/FINANCE/DIREKTUR ditolak', async () => {
    for (const who of ['pm', 'finance', 'direktur', 'investor'] as const) {
      await ctx.api(who).put('/settings/global', { interestRate: '0.12' }).expect(403);
    }
  });

  it('ADMIN mengubah → audit log nilai lama → baru', async () => {
    const res = await ctx.api('admin').put('/settings/global', { interestRate: '0.12' }).expect(200);
    expect(res.body.interestRate).toBe('0.12');
    const log = await ctx.prisma.auditLog.findFirst({
      where: { entity: 'Setting', field: 'interestRate' },
      orderBy: { at: 'desc' },
      include: { user: true },
    });
    expect(log).toMatchObject({ oldValue: '0.1', newValue: '0.12' });
    expect(log?.user?.role).toBe('ADMIN');
    await ctx.api('admin').put('/settings/global', { interestRate: '0.10' }).expect(200);
  });
});

describe('Akses INVESTOR per project', () => {
  it('investor hanya melihat ADW', async () => {
    const res = await ctx.api('investor').get('/projects').expect(200);
    expect(res.body.map((p: { code: string }) => p.code)).toEqual(['ADW']);
    const rekap = await ctx.api('investor').get('/budget/rekap').expect(200);
    expect(rekap.body.projects).toHaveLength(1);
    const ev = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' } });
    await ctx.api('investor').get(`/projects/${ev.id}/budget`).expect(404);
    const sinagar = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Sinagar Tasik');
    await ctx.api('investor').get(`/clusters/${sinagar}`).expect(404);
  });

  it('role lain melihat semua project', async () => {
    const res = await ctx.api('finance').get('/projects').expect(200);
    expect(res.body).toHaveLength(3);
  });
});

describe('Cluster — CRUD, template default, duplicate, audit', () => {
  it('cluster baru memakai template (Evantama pajak 2,65%)', async () => {
    const ev = await ctx.prisma.project.findUniqueOrThrow({ where: { code: 'EVANTAMA' } });
    const res = await ctx.api('pm').post('/clusters', { projectId: ev.id, name: 'Cluster Uji Template', nilaiPoImpl: '100000000' }).expect(201);
    expect(res.body.pajakRate).toBe('0.0265');
    expect(res.body.retensiRate).toBe('0.1');
    const subcon = res.body.lines.find((l: { code: string }) => l.code === 'SUBCON');
    expect(subcon).toMatchObject({ mode: 'PCT', pct: '0.69' });
    await ctx.api('finance').post('/clusters', { projectId: ev.id, name: 'X', nilaiPoImpl: '1' }).expect(403);
  });

  it('edit baris budget (toggle PCT → RP) tercatat di audit', async () => {
    const id = await clusterId(ctx.prisma, 'EVANTAMA', 'Cluster Uji Template');
    await ctx.api('pm').put(`/clusters/${id}/budget-lines`, [{ code: 'SUBCON', mode: 'RP', amount: '65000000' }]).expect(200);
    const logs = await ctx.prisma.auditLog.findMany({ where: { entity: 'Cluster', entityId: id, field: { startsWith: 'line.SUBCON' } } });
    const byField = Object.fromEntries(logs.map((l) => [l.field, l]));
    expect(byField['line.SUBCON.mode']).toMatchObject({ oldValue: 'PCT', newValue: 'RP' });
    expect(byField['line.SUBCON.amount']).toMatchObject({ oldValue: null, newValue: '65000000' });
    const detail = await ctx.api('pm').get(`/clusters/${id}`).expect(200);
    expect(detail.body.calc.lines.SUBCON.amount).toBe('65000000.00');
  });

  it('duplicate menyalin budget lines', async () => {
    const id = await clusterId(ctx.prisma, 'ADW', 'WANASARI RW 01 SUBANG');
    const res = await ctx.api('pm').post(`/clusters/${id}/duplicate`, { name: 'WANASARI RW 01 SUBANG (copy)' }).expect(201);
    expect(res.body.status).toBe('PLAN');
    expect(res.body.lines.find((l: { code: string }) => l.code === 'SUBCON')).toMatchObject({ mode: 'RP', amount: '6952900' });
    await ctx.api('pm').post(`/clusters/${id}/duplicate`, { name: 'WANASARI RW 01 SUBANG (copy)' }).expect(409);
    await ctx.api('admin').del(`/clusters/${res.body.id}`).expect(200);
  });
});

describe('Import & export Excel', () => {
  it('dry-run file contoh setelah seed → semua UNCHANGED', async () => {
    const { srv, auth } = ctx.api('pm').raw();
    const res = await srv
      .post('/api/import/budget-xlsx?mode=dry-run')
      .set(auth)
      .attach('file', readFileSync(SAMPLE), 'Budget.xlsx')
      .expect(200);
    const statuses = res.body.clusters
      .filter((c: { name: string }) => !c.name.startsWith('Cluster Uji'))
      .map((c: { status: string }) => c.status);
    expect(new Set(statuses)).toEqual(new Set(['UNCHANGED']));
    expect(res.body.sheets.map((s: { projectCode: string }) => s.projectCode)).toEqual(['ADW', 'EVANTAMA', 'CCSI']);
  });

  it('dry-run mendeteksi perubahan dengan diff, commit menyimpan + audit', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(SAMPLE);
    const ws = wb.getWorksheet('CCSI')!;
    ws.getCell('E4').value = 50000000; // Nilai PO Implementasi cluster pertama CCSI
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { srv, auth } = ctx.api('pm').raw();
    const dry = await srv.post('/api/import/budget-xlsx').set(auth).attach('file', buf, 'b.xlsx').expect(200);
    const changed = dry.body.clusters.filter((c: { status: string }) => c.status === 'CHANGED');
    expect(changed).toHaveLength(1);
    expect(changed[0].diffs).toEqual([{ field: 'nilaiPoImpl', oldValue: expect.any(String), newValue: '50000000' }]);
    const commit = await srv
      .post('/api/import/budget-xlsx?mode=commit')
      .set(auth)
      .field('keys', JSON.stringify([changed[0].key]))
      .attach('file', buf, 'b.xlsx')
      .expect(200);
    expect(commit.body).toMatchObject({ created: 0, updated: 1 });
    // kembalikan nilai asal
    await srv.post('/api/import/budget-xlsx?mode=commit').set(auth).attach('file', readFileSync(SAMPLE), 'b.xlsx').expect(200);
  });

  it('INVESTOR/FINANCE tidak boleh import', async () => {
    const { srv } = ctx.api('finance').raw();
    await srv
      .post('/api/import/budget-xlsx')
      .set(ctx.api('finance').raw().auth)
      .attach('file', Buffer.from('x'), 'b.xlsx')
      .expect(403);
  });

  it('export budget → import ulang tanpa perubahan (round-trip)', async () => {
    const { srv, auth } = ctx.api('pm').raw();
    const exp = await srv.get('/api/export/budget.xlsx').set(auth).buffer(true).parse(binaryParser).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exp.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Rekap', 'ADW', 'CCSI', 'EVANTAMA']);
    const parsed = parseBudgetWorkbook(wb);
    expect(parsed.interestRate).toBe('0.1');
    expect(parsed.retensiAsCost).toBe(true);
    const dry = await srv.post('/api/import/budget-xlsx').set(auth).attach('file', exp.body, 'export.xlsx').expect(200);
    const notUnchanged = dry.body.clusters.filter((c: { status: string }) => c.status !== 'UNCHANGED');
    expect(notUnchanged).toEqual([]);
  });
});
