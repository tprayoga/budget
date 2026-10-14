/* Pemindaian over budget manual (mis. setelah migrasi / perubahan penerima). Mengirim notifikasi lintasan baru:
 * total cluster ≥ ambang → langsung; pos → ringkasan harian. Pemakaian: node dist-scripts/scripts/scan-overruns.js
 */
import { PrismaClient } from '@prisma/client';
import { scanOverruns } from '../src/notifications/overrun';
import { closeRedis } from '../src/redis/redis';

async function main() {
  const prisma = new PrismaClient();
  const r = await scanOverruns(prisma);
  console.log(JSON.stringify(r));
  await prisma.$disconnect();
  await closeRedis();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
