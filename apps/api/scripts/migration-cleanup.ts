/* Cleanup data UJI COBA sebelum migrasi ke production — dijalankan pada DB SEMENTARA hasil restore dump lokal,
 * BUKAN pada DB Docker lokal. Default DRY-RUN: semua perubahan dijalankan dalam satu transaksi lalu di-ROLLBACK,
 * hanya laporan jumlah baris yang ditampilkan. --apply untuk benar-benar menerapkan (setelah disetujui).
 *
 * Keputusan user (Fase 4, 1a–1c):
 *  - user sistem "Migrasi Sistem" (nonaktif, tidak bisa login)
 *  - dihapus: semua FundRequest (+ baris, approval, lampiran, file), FpdSequence, Expense MANUAL/MOBILE/WEBHOOK
 *    (+ alokasi, file), Notification, OverrunState, ApiKey, RefreshToken, ProjectMember milik akun demo
 *  - field pelaku pada data ASLI yang merujuk akun demo → "Migrasi Sistem"; AuditLog TIDAK diubah
 *  - akun demo yang masih dirujuk AuditLog → dianonimkan (nonaktif, "Akun demo (dihapus)", email & password acak);
 *    yang tidak dirujuk → dihapus
 *
 * Pemakaian: DATABASE_URL=... node dist-scripts/scripts/migration-cleanup.js [--apply] [--report laporan.json]
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { rekapSnapshot } from './rekap-snapshot';

const DEMO_DOMAIN = '@indotek.test';
export const MIGRATION_USER_EMAIL = 'migrasi-sistem@sistem.invalid';
class Rollback extends Error {}

type Row = { tabel: string; aksi: string; jumlah: number };

export async function migrationCleanup(prisma: PrismaClient, apply: boolean) {
  const report: Row[] = [];
  const files: string[] = [];
  const add = (tabel: string, aksi: string, jumlah: number) => report.push({ tabel, aksi, jumlah });
  const before = await rekapSnapshot(prisma);

  const run = async (tx: Prisma.TransactionClient) => {
    const demo = await tx.user.findMany({ where: { email: { endsWith: DEMO_DOMAIN } }, select: { id: true, email: true } });
    const demoIds = demo.map((u) => u.id);

    // 1a. user sistem
    let sys = await tx.user.findUnique({ where: { email: MIGRATION_USER_EMAIL } });
    if (!sys) {
      sys = await tx.user.create({
        data: {
          email: MIGRATION_USER_EMAIL,
          name: 'Migrasi Sistem',
          role: 'FINANCE',
          jabatan: 'Akun sistem migrasi (tidak bisa login)',
          active: false,
          mustChangePassword: true,
          passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
        },
      });
      add('User', 'dibuat: Migrasi Sistem (nonaktif)', 1);
    }

    // 1b. data uji coba — pengajuan dana (semua)
    const frAtt = await tx.attachment.findMany({ where: { fileUrl: { not: null } }, select: { fileUrl: true } });
    files.push(...frAtt.map((a) => a.fileUrl!));
    add('Expense', 'fundRequestId dikosongkan (data asli yang tertaut ke pengajuan)', (await tx.expense.updateMany({ where: { fundRequestId: { not: null }, source: { in: ['IMPORT_RAB', 'CLIENT_PAYMENT'] } }, data: { fundRequestId: null } })).count);
    add('Approval', 'dihapus', (await tx.approval.deleteMany({})).count);
    add('Attachment', 'dihapus (lampiran pengajuan)', (await tx.attachment.deleteMany({})).count);
    add('FundRequestLine', 'dihapus', (await tx.fundRequestLine.deleteMany({})).count);
    const testExp = await tx.expense.findMany({ where: { source: { in: ['MANUAL', 'MOBILE', 'WEBHOOK'] } }, select: { id: true, attachmentUrl: true } });
    files.push(...testExp.map((e) => e.attachmentUrl).filter((x): x is string => !!x));
    add('ExpenseAllocation', 'dihapus (expense MANUAL/MOBILE/WEBHOOK)', (await tx.expenseAllocation.deleteMany({ where: { expenseId: { in: testExp.map((e) => e.id) } } })).count);
    add('Expense', 'dihapus (MANUAL/MOBILE/WEBHOOK)', (await tx.expense.deleteMany({ where: { id: { in: testExp.map((e) => e.id) } } })).count);
    add('FundRequest', 'dihapus (semua)', (await tx.fundRequest.deleteMany({})).count);
    add('FpdSequence', 'dihapus (penomoran FPD mulai dari 001)', (await tx.fpdSequence.deleteMany({})).count);
    add('Notification', 'dihapus', (await tx.notification.deleteMany({})).count);
    // status lintasan over budget dikosongkan → pemindaian pertama di production (setelah akun PM & Direktur dibuat)
    // mengirim ringkasan kondisi terkini (keputusan user, persetujuan dry-run migrasi)
    add('OverrunState', 'dihapus (pemindaian pertama di production mengirim ringkasan terkini)', (await tx.overrunState.deleteMany({})).count);
    add('ApiKey', 'dihapus', (await tx.apiKey.deleteMany({})).count);
    add('RefreshToken', 'dihapus (semua sesi)', (await tx.refreshToken.deleteMany({})).count);
    add('ProjectMember', 'dihapus (milik akun demo)', (await tx.projectMember.deleteMany({ where: { userId: { in: demoIds } } })).count);

    // 1c. pelaku pada data asli → Migrasi Sistem
    const to = { in: demoIds };
    add('Expense.createdById', 'dialihkan ke Migrasi Sistem', (await tx.expense.updateMany({ where: { createdById: to }, data: { createdById: sys.id } })).count);
    add('Expense.verifiedById', 'dialihkan ke Migrasi Sistem', (await tx.expense.updateMany({ where: { verifiedById: to }, data: { verifiedById: sys.id } })).count);
    add('ClientInvoiceRef.appliedById', 'dialihkan ke Migrasi Sistem', (await tx.clientInvoiceRef.updateMany({ where: { appliedById: to }, data: { appliedById: sys.id } })).count);
    add('ImportMappingRule.createdById', 'dialihkan ke Migrasi Sistem', (await tx.importMappingRule.updateMany({ where: { createdById: to }, data: { createdById: sys.id } })).count);
    add('ImportHeldItem.resolvedById', 'dialihkan ke Migrasi Sistem', (await tx.importHeldItem.updateMany({ where: { resolvedById: to }, data: { resolvedById: sys.id } })).count);
    add('FieldOverride.userId', 'dialihkan ke Migrasi Sistem', (await tx.fieldOverride.updateMany({ where: { userId: to }, data: { userId: sys.id } })).count);
    add('AuditLog', 'TIDAK diubah (merujuk akun demo)', await tx.auditLog.count({ where: { userId: to } }));

    // akun demo: dianonimkan bila dirujuk AuditLog, selain itu dihapus
    let anon = 0;
    let del = 0;
    for (const u of demo) {
      const refs = await tx.auditLog.count({ where: { userId: u.id } });
      if (refs) {
        await tx.user.update({
          where: { id: u.id },
          data: {
            name: 'Akun demo (dihapus)',
            email: `demo-${randomBytes(6).toString('hex')}@dihapus.invalid`,
            jabatan: null,
            active: false,
            mustChangePassword: true,
            passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
          },
        });
        anon++;
      } else {
        await tx.user.delete({ where: { id: u.id } });
        del++;
      }
    }
    add('User (akun demo)', 'dianonimkan + nonaktif (dirujuk AuditLog)', anon);
    add('User (akun demo)', 'dihapus (tidak dirujuk)', del);
    add('User', 'aktif setelah cleanup (admin awal dibuat seed production)', await tx.user.count({ where: { active: true } }));

    const after = await rekapSnapshot(tx as unknown as PrismaClient);
    return after;
  };

  let after: Awaited<ReturnType<typeof rekapSnapshot>> | null = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        after = await run(tx);
        if (!apply) throw new Rollback();
      },
      { timeout: 300_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return { report, files, before, after: after!, rekapSama: before.sha256 === after!.sha256 };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const ri = process.argv.indexOf('--report');
  const prisma = new PrismaClient();
  const r = await migrationCleanup(prisma, apply);
  console.log(`=== ${apply ? 'APPLY' : 'DRY-RUN (di-rollback, tidak ada yang berubah)'} cleanup migrasi`);
  console.log('| Tabel | Aksi | Jumlah baris |\n|---|---|---|');
  for (const x of r.report) console.log(`| ${x.tabel} | ${x.aksi} | ${x.jumlah} |`);
  console.log(`\nFile upload yang dibuang dari arsip: ${r.files.length}${r.files.length ? `\n - ${r.files.join('\n - ')}` : ''}`);
  console.log(`Rekap sebelum: ${r.before.sha256}\nRekap sesudah: ${r.after.sha256}\nRekap sama persis: ${r.rekapSama ? 'YA' : 'TIDAK'}`);
  if (ri > 0) await writeFile(process.argv[ri + 1], JSON.stringify(r, null, 2));
  await prisma.$disconnect();
  if (!r.rekapSama) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
