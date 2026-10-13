import { dec, formatAngka, formatPersen, formatRupiah, type Num } from '@indotek/shared';

export { formatAngka, formatPersen, formatRupiah };
export { formatTanggal, formatTanggalJam } from '@indotek/shared';

export function isNegative(v: Num | null | undefined): boolean {
  if (v === null || v === undefined || v === '') return false;
  const d = dec(v);
  return d.isNegative() && !d.isZero();
}

/** Rasio "0.025" → "2.5" untuk input persen. */
export function ratioToPctInput(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  return dec(v).times(100).toDecimalPlaces(6).toString();
}

/** Input persen "2,5" → rasio "0.025". */
export function pctInputToRatio(v: string): string | null {
  const s = v.replace(',', '.').replace('%', '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return dec(s).div(100).toString();
}

/** Input rupiah "1.234.567" / "1234567,5" → "1234567.5". */
export function rpInputToValue(v: string): string | null {
  let s = v.replace(/rp/gi, '').replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return dec(s).toString();
}
