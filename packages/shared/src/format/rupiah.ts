import { D, dec, type Num } from '../calc/decimal';

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Angka format Indonesia: 1.234.567,89 (tanpa "Rp"). */
export function formatAngka(value: Num | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || value === '') return '';
  const d = dec(value).toDecimalPlaces(decimals, D.ROUND_HALF_UP);
  const neg = d.isNegative() && !d.isZero();
  const [i, f] = d.abs().toFixed(decimals).split('.');
  return `${neg ? '-' : ''}${groupThousands(i)}${f ? `,${f}` : ''}`;
}

/** "Rp 1.234.567"; negatif "-Rp 76.628". */
export function formatRupiah(value: Num | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || value === '') return '';
  const s = formatAngka(value, decimals);
  return s.startsWith('-') ? `-Rp ${s.slice(1)}` : `Rp ${s}`;
}

/** Rasio → persen: 0.0265 → "2,65%". */
export function formatPersen(value: Num | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '';
  return `${formatAngka(dec(value).times(100), decimals)}%`;
}

/** Parse input pengguna "1.234.567,5" / "1234567.5" / "Rp 1.234" → string desimal. null bila tidak valid. */
export function parseAngka(input: string): string | null {
  let s = input.replace(/rp/gi, '').replace(/\s/g, '').replace(/%$/, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const dots = (s.match(/\./g) ?? []).length;
  if (hasComma) s = s.replace(/\./g, '').replace(',', '.');
  else if (dots > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new D(s).toString();
}
