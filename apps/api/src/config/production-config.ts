/**
 * Validasi konfigurasi saat start dengan NODE_ENV=production: secret wajib diisi, panjang minimal, dan bukan
 * nilai default dev. Gagal cepat lebih baik daripada berjalan dengan secret lemah.
 */
const REQUIRED_SECRETS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET'] as const;

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  for (const k of REQUIRED_SECRETS) {
    const v = env[k] ?? '';
    if (v.length < 32) problems.push(`${k} wajib diisi (minimal 32 karakter)`);
    else if (/dev-|ganti-di-produksi/.test(v)) problems.push(`${k} masih nilai default dev`);
  }
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) problems.push('JWT_ACCESS_SECRET dan JWT_REFRESH_SECRET harus berbeda');
  if (!env.DATABASE_URL) problems.push('DATABASE_URL wajib diisi');
  if (!env.REDIS_URL) problems.push('REDIS_URL wajib diisi (rate limit & lock lintas replika)');
  if (env.COOKIE_SECURE === 'false') problems.push('COOKIE_SECURE=false tidak boleh di production');
  if (problems.length) throw new Error(`Konfigurasi production tidak valid:\n - ${problems.join('\n - ')}`);
}
