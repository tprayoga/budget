import DecimalBase from 'decimal.js';

/**
 * Decimal khusus perhitungan uang: presisi 40 digit signifikan, pembulatan HALF_UP.
 * JANGAN pakai number/float untuk uang.
 */
export const D = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });
export type D = InstanceType<typeof D>;

/** Nilai yang bisa diubah menjadi Decimal (string dari API/DB, number dari input, Decimal). */
export type Num = string | number | { toString(): string };

export const ZERO = new D(0);

export function dec(v: Num | null | undefined): D {
  if (v === null || v === undefined || v === '') return new D(0);
  if (v instanceof D) return v;
  return new D(typeof v === 'number' ? v : v.toString());
}

/** Bulatkan HALF_UP ke n desimal. */
export function roundHalfUp(v: Num, dp = 0): D {
  return dec(v).toDecimalPlaces(dp, D.ROUND_HALF_UP);
}

/** Pembulatan saat disimpan ke DB: 2 desimal HALF_UP. */
export function roundMoney(v: Num): D {
  return roundHalfUp(v, 2);
}

/** Bagi dengan aman: pembagi 0 → 0. */
export function safeDiv(a: Num, b: Num): D {
  const den = dec(b);
  return den.isZero() ? new D(0) : dec(a).div(den);
}

export function sum(values: Num[]): D {
  return values.reduce<D>((acc, v) => acc.plus(dec(v)), new D(0));
}

/** Serialisasi uang ke string 2 desimal (format kirim API / simpan DB). */
export function moneyStr(v: Num): string {
  return roundMoney(v).toFixed(2);
}

/** Serialisasi persentase/rasio dengan 8 desimal (Decimal(12,8) di DB). */
export function rateStr(v: Num): string {
  return roundHalfUp(v, 8).toFixed(8);
}
