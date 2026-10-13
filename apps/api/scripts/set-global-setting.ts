/* Ubah setting global lewat SettingsService (jalur yang sama dengan PUT /settings/global; tercatat di AuditLog).
 * Pemakaian: npx ts-node --transpile-only scripts/set-global-setting.ts retensiAsCost=false "alasan"
 * Pelaku audit = sistem (userId kosong) — dijalankan operator atas keputusan user.
 */
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import type { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const [pair, reason] = process.argv.slice(2);
  const [key, raw] = (pair ?? '').split('=');
  if (!key || raw === undefined || !reason) throw new Error('Pemakaian: set-global-setting.ts <field>=<nilai> "<alasan>"');
  const value = raw === 'true' ? true : raw === 'false' ? false : raw;
  const prisma = new PrismaClient();
  const ps = prisma as unknown as PrismaService;
  const settings = new SettingsService(ps, new AuditService(ps));
  const after = await settings.updateGlobal(null, { [key]: value, reason } as never);
  console.log(`Setting global ${key} = ${JSON.stringify((after as Record<string, unknown>)[key])} (alasan: ${reason})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
