export const TIMEZONE = 'Asia/Jakarta';

export const BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/** Tahun/bulan/tanggal menurut zona Asia/Jakarta. */
export function formatJakartaParts(value: Date | string): { year: number; month: number; day: number } {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** "13 Oktober 2026" */
export function formatTanggal(value: Date | string | null | undefined): string {
  if (!value) return '';
  const { year, month, day } = formatJakartaParts(value);
  return `${day} ${BULAN[month - 1]} ${year}`;
}

/** "Oktober 2026" */
export function formatBulanTahun(value: Date | string): string {
  const { year, month } = formatJakartaParts(value);
  return `${BULAN[month - 1]} ${year}`;
}

/** "13 Oktober 2026 14.05" (WIB) */
export function formatTanggalJam(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${formatTanggal(date)} ${t.replace(':', '.')}`;
}

/** Tanggal hari ini di Jakarta dalam format ISO YYYY-MM-DD. */
export function todayJakartaIso(now = new Date()): string {
  const { year, month, day } = formatJakartaParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
