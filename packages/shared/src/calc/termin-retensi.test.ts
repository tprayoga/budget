import { describe, expect, it } from 'vitest';
import { addMonths, isoDay } from './termin';

describe('Tanggal pelepasan retensi = tanggal opname + N bulan', () => {
  it.each([
    ['2026-10-14', 3, '2027-01-14'],
    ['2026-05-31', 3, '2026-08-31'],
    ['2026-11-30', 3, '2027-02-28'],
    ['2027-11-30', 3, '2028-02-29'],
  ])('%s + %i bulan = %s', (from, n, to) => expect(isoDay(addMonths(from, n))).toBe(to));
});
