/* Buat akun asli dari CSV. Password awal acak, wajib diganti saat login pertama.
 * Pemakaian (di server): docker compose ... run --rm api node dist-scripts/scripts/create-users.js /data/users.csv [--out /data/akun-baru.csv]
 * Kolom CSV (baris pertama = header): nama,email,role,jabatan,projects
 *   role: ADMIN | PM | FINANCE | DIREKTUR | INVESTOR ; projects: kode project dipisah ';' (wajib untuk INVESTOR)
 * Email yang sudah ada dilewati (tidak diubah). Hasil (email + password awal) ditulis ke file chmod 600.
 */
import { PrismaClient, type Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const ROLES: Role[] = ['ADMIN', 'PM', 'FINANCE', 'DIREKTUR', 'INVESTOR'];

/** CSV sederhana: koma, tanda kutip ganda untuk nilai berisi koma, "" untuk kutip di dalam nilai. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur.trim());
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  row.push(cur.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

/** Password awal acak 16 karakter (huruf, angka, simbol aman untuk dikirim). */
export function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%*-_';
  const b = randomBytes(16);
  return [...b].map((x) => chars[x % chars.length]).join('');
}

async function main() {
  const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx > 0 ? process.argv[outIdx + 1] : `akun-baru-${new Date().toISOString().slice(0, 10)}.csv`;
  if (!file) throw new Error('Pemakaian: create-users <users.csv> [--out hasil.csv]');
  const rows = parseCsv(await readFile(file, 'utf8'));
  const header = rows.shift()!.map((h) => h.toLowerCase());
  const col = (n: string) => header.indexOf(n);
  for (const n of ['nama', 'email', 'role']) if (col(n) < 0) throw new Error(`Kolom "${n}" tidak ada di header CSV`);

  const prisma = new PrismaClient();
  const audit = new AuditService(prisma as unknown as PrismaService);
  const projects = new Map((await prisma.project.findMany()).map((p) => [p.code.toUpperCase(), p]));
  const result: string[] = ['nama,email,role,password_awal'];
  const errors: string[] = [];
  let created = 0;
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    const name = r[col('nama')];
    const email = r[col('email')]?.toLowerCase();
    const role = r[col('role')]?.toUpperCase() as Role;
    const jabatan = col('jabatan') >= 0 ? r[col('jabatan')] || null : null;
    const codes = col('projects') >= 0 ? (r[col('projects')] ?? '').split(';').map((x) => x.trim().toUpperCase()).filter(Boolean) : [];
    if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`baris ${line}: nama/email tidak valid`);
    else if (!ROLES.includes(role)) errors.push(`baris ${line}: role "${r[col('role')]}" tidak dikenal (${ROLES.join('/')})`);
    else if (role === 'INVESTOR' && !codes.length) errors.push(`baris ${line}: INVESTOR wajib punya kolom projects`);
    else if (codes.some((c) => !projects.has(c))) errors.push(`baris ${line}: project ${codes.filter((c) => !projects.has(c)).join(', ')} tidak ada`);
    else if (await prisma.user.findUnique({ where: { email } })) console.error(`lewati (sudah ada): ${email}`);
    else {
      const password = randomPassword();
      const user = await prisma.user.create({
        data: { name, email, role, jabatan, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true },
      });
      for (const c of codes) await prisma.projectMember.create({ data: { userId: user.id, projectId: projects.get(c)!.id } });
      await audit.diff(prisma, null, 'User', user.id, null, { email, role, projects: codes.join(';') || null, sumber: 'create-users CSV' });
      result.push(`"${name.replace(/"/g, '""')}",${email},${role},${password}`);
      created++;
    }
  }
  if (out === '-') {
    // stdout = CSV hasil (dialihkan wrapper ke file chmod 600); pesan lain ke stderr
    if (created) process.stdout.write(`${result.join('\n')}\n`);
    console.error(`Akun dibuat: ${created}.`);
  } else {
    if (created) {
      await writeFile(out, `${result.join('\n')}\n`, { mode: 0o600 });
      await chmod(out, 0o600);
    }
    console.log(`Akun dibuat: ${created}. ${created ? `Password awal di ${out} (chmod 600) — bagikan lewat kanal aman, lalu HAPUS file ini.` : ''}`);
  }
  if (errors.length) {
    console.error(`Baris ditolak:\n - ${errors.join('\n - ')}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
