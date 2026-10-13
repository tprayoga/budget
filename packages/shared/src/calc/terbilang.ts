import { dec, roundHalfUp, type Num } from './decimal';

const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
/** Skala ribuan; indeks = pangkat 1000. */
const SKALA = ['', 'ribu', 'juta', 'milyar', 'triliun'];

/** 1..999 → kata (huruf kecil). */
function ratusan(n: number): string {
  const words: string[] = [];
  const r = Math.floor(n / 100);
  const sisa = n % 100;
  if (r === 1) words.push('seratus');
  else if (r > 1) words.push(`${SATUAN[r]} ratus`);
  if (sisa === 10) words.push('sepuluh');
  else if (sisa === 11) words.push('sebelas');
  else if (sisa > 11 && sisa < 20) words.push(`${SATUAN[sisa - 10]} belas`);
  else {
    const p = Math.floor(sisa / 10);
    const s = sisa % 10;
    if (p > 0) words.push(`${SATUAN[p]} puluh`);
    if (s > 0) words.push(SATUAN[s]);
  }
  return words.join(' ');
}

/** Bilangan bulat ≥ 0 → kata Bahasa Indonesia huruf kecil (tanpa "rupiah"). */
export function angkaKeKata(value: Num): string {
  const n = roundHalfUp(value, 0);
  if (n.isNegative() && !n.isZero()) return `minus ${angkaKeKata(n.abs())}`;
  if (n.isZero()) return 'nol';
  const digits = n.toFixed(0);
  if (digits.length > SKALA.length * 3) throw new Error('Angka terlalu besar untuk terbilang');

  const groups: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(Number(digits.slice(Math.max(0, end - 3), end)));
  }
  const words: string[] = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    const scale = SKALA[groups.length - 1 - i];
    if (scale === 'ribu' && g === 1) words.push('seribu');
    else words.push(scale ? `${ratusan(g)} ${scale}` : ratusan(g));
  });
  return words.join(' ');
}

/**
 * Terbilang rupiah: huruf pertama kapital, diakhiri "rupiah".
 * Contoh: 7.708.170 → "Tujuh juta tujuh ratus delapan ribu seratus tujuh puluh rupiah".
 */
export function terbilang(value: Num): string {
  const kata = `${angkaKeKata(dec(value))} rupiah`;
  return kata.charAt(0).toUpperCase() + kata.slice(1);
}
