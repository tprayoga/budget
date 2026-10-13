import { describe, expect, it } from 'vitest';
import { formatAngka, formatPersen, formatRupiah, parseAngka } from './rupiah';
import { formatTanggal } from './tanggal';
import { allowedActions, inboxStatuses } from '../workflow';

describe('format', () => {
  it('rupiah', () => {
    expect(formatRupiah('1234567')).toBe('Rp 1.234.567');
    expect(formatRupiah('-76628.3')).toBe('-Rp 76.628');
    expect(formatRupiah('236021.25', 2)).toBe('Rp 236.021,25');
    expect(formatAngka('0.4')).toBe('0');
  });
  it('persen', () => {
    expect(formatPersen('0.0265')).toBe('2,65%');
    expect(formatPersen('-0.0081166738')).toBe('-0,81%');
  });
  it('parse angka', () => {
    expect(parseAngka('Rp 1.234.567')).toBe('1234567');
    expect(parseAngka('2,65')).toBe('2.65');
    expect(parseAngka('0.5')).toBe('0.5');
    expect(parseAngka('abc')).toBeNull();
  });
  it('tanggal Asia/Jakarta', () => {
    expect(formatTanggal('2026-10-13T00:00:00+07:00')).toBe('13 Oktober 2026');
    expect(formatTanggal(new Date('2026-10-12T18:00:00Z'))).toBe('13 Oktober 2026');
  });
});

describe('workflow', () => {
  it('aksi sesuai role & status', () => {
    expect(allowedActions('DRAFT', 'PM')).toEqual(['SUBMIT']);
    expect(allowedActions('DIAJUKAN', 'FINANCE')).toEqual(['APPROVE', 'REJECT']);
    expect(allowedActions('DIAJUKAN', 'DIREKTUR')).toEqual([]);
    expect(allowedActions('DIPERIKSA_FINANCE', 'DIREKTUR')).toEqual(['APPROVE', 'REJECT']);
    expect(allowedActions('DISETUJUI_DIREKTUR', 'INVESTOR')).toEqual(['APPROVE', 'REJECT']);
    expect(allowedActions('DIKETAHUI_INVESTOR', 'FINANCE')).toEqual(['DISBURSE']);
    expect(allowedActions('DITOLAK', 'PM')).toEqual(['REVISE']);
    expect(allowedActions('DICAIRKAN', 'FINANCE')).toEqual([]);
  });
  it('inbox', () => {
    expect(inboxStatuses('FINANCE')).toEqual(['DIAJUKAN', 'DIKETAHUI_INVESTOR']);
    expect(inboxStatuses('INVESTOR')).toEqual(['DISETUJUI_DIREKTUR']);
    expect(inboxStatuses('PM')).toEqual(['DITOLAK']);
  });
});
