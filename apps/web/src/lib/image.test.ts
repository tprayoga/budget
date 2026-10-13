import { describe, expect, it } from 'vitest';
import { scaleToFit } from './image';

describe('kompres foto nota', () => {
  it('sisi terpanjang maks 1600, rasio tetap', () => {
    expect(scaleToFit(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaleToFit(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(scaleToFit(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
