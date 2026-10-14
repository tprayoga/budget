/* Reset password satu akun: password acak baru, wajib ganti saat login berikutnya, semua sesi dicabut.
 * Pemakaian: ... run --rm api node dist-scripts/scripts/reset-password.js <email>
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { randomPassword } from './create-users';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Pemakaian: reset-password <email>');
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`User ${email} tidak ditemukan`);
  if (!user.active) throw new Error(`User ${email} nonaktif`);
  const password = randomPassword();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true } });
    await tx.refreshToken.deleteMany({ where: { userId: user.id } });
    await new AuditService(prisma as unknown as PrismaService).diff(tx, null, 'User', user.id, { password: '***' }, { password: 'direset', sumber: 'reset-password CLI' });
  });
  console.log(`Password sementara ${email}: ${password}\n(wajib diganti saat login; semua sesi lama dicabut)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
