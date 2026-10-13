import { Prisma } from '@prisma/client';
import { dec, moneyStr, rateStr, type Num } from '@indotek/shared';

/** Prisma.Decimal / null → string desimal (untuk dikirim lewat API). */
export function s(v: Prisma.Decimal | null | undefined): string | null {
  return v === null || v === undefined ? null : v.toString();
}

export function money(v: Num): Prisma.Decimal {
  return new Prisma.Decimal(moneyStr(v));
}

export function rate(v: Num): Prisma.Decimal {
  return new Prisma.Decimal(rateStr(v));
}

export function eqDecimal(a: Num | null | undefined, b: Num | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a == b;
  return dec(a).eq(dec(b));
}
