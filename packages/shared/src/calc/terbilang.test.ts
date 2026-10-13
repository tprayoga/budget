import { describe, expect, it } from 'vitest';
import { terbilang } from './terbilang';

describe('Acceptance E — terbilang', () => {
  it.each([
    [0, 'Nol rupiah'],
    [1000, 'Seribu rupiah'],
    [11000011, 'Sebelas juta sebelas rupiah'],
    [1250000000, 'Satu milyar dua ratus lima puluh juta rupiah'],
    [7708170, 'Tujuh juta tujuh ratus delapan ribu seratus tujuh puluh rupiah'],
  ])('%s → %s', (n, expected) => expect(terbilang(n)).toBe(expected));

  it.each([
    [10, 'Sepuluh rupiah'],
    [11, 'Sebelas rupiah'],
    [15, 'Lima belas rupiah'],
    [100, 'Seratus rupiah'],
    [111, 'Seratus sebelas rupiah'],
    [1001, 'Seribu satu rupiah'],
    [2000, 'Dua ribu rupiah'],
    [100000, 'Seratus ribu rupiah'],
    [101000, 'Seratus satu ribu rupiah'],
    [1000000, 'Satu juta rupiah'],
    [3854083, 'Tiga juta delapan ratus lima puluh empat ribu delapan puluh tiga rupiah'],
    [1000000000000, 'Satu triliun rupiah'],
  ])('aturan dasar %s', (n, expected) => expect(terbilang(n)).toBe(expected));

  it('menerima string desimal & membulatkan HALF_UP', () => {
    expect(terbilang('7708169.5')).toBe('Tujuh juta tujuh ratus delapan ribu seratus tujuh puluh rupiah');
  });
});
