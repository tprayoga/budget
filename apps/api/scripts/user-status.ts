/* Nonaktifkan / aktifkan akun. Nonaktif = tidak bisa login, semua sesi dicabut. Tercatat di AuditLog.
 * Pemakaian: ... run --rm api node dist-scripts/scripts/user-status.js <email> nonaktif|aktif
 */
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const mode = process.argv[3];
  if (!email || !['nonaktif', 'aktif'].includes(mode ?? '')) throw new Error('Pemakaian: user-status <email> nonaktif|aktif');
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`User ${email} tidak ditemukan`);
  const active = mode === 'aktif';
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { active } });
    if (!active) await tx.refreshToken.deleteMany({ where: { userId: user.id } });
    await new AuditService(prisma as unknown as PrismaService).diff(tx, null, 'User', user.id, { active: String(user.active) }, { active: String(active), sumber: 'user-status CLI' });
  });
  console.log(`${email}: ${active ? 'aktif' : 'nonaktif (semua sesi dicabut)'}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
