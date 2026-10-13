import type { FrCode, PrismaClient } from '@prisma/client';
import { dec, FR_CODES, type D } from '@indotek/shared';
import type { Tx } from '../prisma/prisma.service';

/**
 * Realisasi tanpa pengajuan per pos untuk satu cluster = Σ alokasi expense TERVERIFIKASI ke cluster itu yang
 * tidak ditautkan ke pengajuan (fundRequestId = null), dikelompokkan per pos budget expense.
 * Expense yang ditautkan ke pengajuan DICAIRKAN otomatis keluar dari angka ini (sudah terhitung di sudahDicairkan).
 */
export async function realisasiTanpaPengajuan(db: PrismaClient | Tx, clusterId: string): Promise<Record<FrCode, D>> {
  const out = Object.fromEntries(FR_CODES.map((c) => [c, dec(0)])) as Record<FrCode, D>;
  const rows = await db.expenseAllocation.findMany({
    where: { clusterId, expense: { status: 'TERVERIFIKASI', fundRequestId: null } },
    select: { amount: true, expense: { select: { budgetCode: true } } },
  });
  for (const r of rows) out[r.expense.budgetCode] = out[r.expense.budgetCode].plus(r.amount.toString());
  return out;
}
