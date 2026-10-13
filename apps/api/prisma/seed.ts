/* Seed data demo Fase 1: setting & template default, client, project, user per role, cluster dari file contoh. */
import { PrismaClient, type BudgetCode, type Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AuditService } from '../src/audit/audit.service';
import { BudgetImporter } from '../src/import/budget-importer';
import { SettingsService } from '../src/settings/settings.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();

/** Default template saat membuat cluster baru (bisa diubah per cluster / per project lewat aplikasi). */
const DEFAULT_TEMPLATE = {
  pajakRate: '0.025',
  retensiRate: '0.10',
  lines: {
    SUBCON: '0.69',
    TICKET: '0',
    INDIRECT: '0.005',
    DIRECT: '0.01',
    OPS_KANTOR: '0.01',
    MOTOR_MOBIL: '0.005',
    HOMEBASE: '0.02',
    ALLOWANCE: '0.02',
    MARKETING: '0.01',
  } satisfies Record<BudgetCode, string>,
};

const CLIENTS = ['PT ADW', 'PT Evantama Network System', 'CCSI'];

const PROJECTS = [
  { code: 'ADW', name: 'Proyek FTTH ADW 2026', client: 'PT ADW', year: 2026, pajakRate: null },
  { code: 'EVANTAMA', name: 'Proyek FTTH Evantama 2026', client: 'PT Evantama Network System', year: 2026, pajakRate: '0.0265' },
  { code: 'CCSI', name: 'Proyek FTTH CCSI 2026', client: 'CCSI', year: 2026, pajakRate: null },
];

const USERS: { email: string; name: string; role: Role; jabatan: string; projects?: string[] }[] = [
  { email: 'admin@indotek.test', name: 'Admin Indotek', role: 'ADMIN', jabatan: 'Administrator Sistem' },
  { email: 'pm@indotek.test', name: 'Andi Pratama', role: 'PM', jabatan: 'Project Manager' },
  { email: 'finance@indotek.test', name: 'Siti Rahmawati', role: 'FINANCE', jabatan: 'Finance' },
  { email: 'direktur@indotek.test', name: 'Budi Santoso', role: 'DIREKTUR', jabatan: 'Direktur' },
  // Investor demo hanya terdaftar di project ADW (untuk menguji pembatasan akses)
  { email: 'investor@indotek.test', name: 'Hendra Wijaya', role: 'INVESTOR', jabatan: 'Investor', projects: ['ADW'] },
];

const SAMPLE = path.resolve(__dirname, '../../../docs/samples/Budget_Per_Cluster_ADW_Evantama_CCSI.xlsx');

async function main() {
  const password = process.env.SEED_PASSWORD || 'Indotek123!';
  const audit = new AuditService(prisma as unknown as PrismaService);
  const settings = new SettingsService(prisma as unknown as PrismaService, audit);

  // Setting global
  const global = await prisma.setting.findFirst({ where: { projectId: null } });
  if (!global) {
    await prisma.setting.create({
      data: {
        projectId: null,
        interestRate: '0.10',
        retensiAsCost: true,
        rekeningBank: 'BCA',
        rekeningNo: '1234567890',
        rekeningNama: 'PT Indotek Buana Karya',
      },
    });
  }

  // Template global
  let tpl = await prisma.budgetTemplate.findFirst({ where: { projectId: null } });
  if (!tpl) {
    tpl = await prisma.budgetTemplate.create({
      data: {
        projectId: null,
        pajakRate: DEFAULT_TEMPLATE.pajakRate,
        retensiRate: DEFAULT_TEMPLATE.retensiRate,
        lines: {
          create: Object.entries(DEFAULT_TEMPLATE.lines).map(([code, pct]) => ({
            code: code as BudgetCode,
            mode: 'PCT' as const,
            pct,
          })),
        },
      },
    });
  }

  for (const name of CLIENTS) {
    await prisma.client.upsert({ where: { name }, create: { name }, update: {} });
  }

  for (const p of PROJECTS) {
    const client = await prisma.client.findUniqueOrThrow({ where: { name: p.client } });
    const project = await prisma.project.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, clientId: client.id, year: p.year },
      update: {},
    });
    if (p.pajakRate) {
      const existing = await prisma.budgetTemplate.findUnique({ where: { projectId: project.id } });
      if (!existing) await prisma.budgetTemplate.create({ data: { projectId: project.id, pajakRate: p.pajakRate } });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, role: u.role, jabatan: u.jabatan, passwordHash },
      update: { name: u.name, role: u.role, jabatan: u.jabatan },
    });
    for (const code of u.projects ?? []) {
      const project = await prisma.project.findUniqueOrThrow({ where: { code } });
      await prisma.projectMember.upsert({
        where: { userId_projectId: { userId: user.id, projectId: project.id } },
        create: { userId: user.id, projectId: project.id },
        update: {},
      });
    }
  }

  // Cluster dari file contoh (hanya NEW/CHANGED; idempotent)
  const importer = new BudgetImporter(prisma, audit, settings);
  const parsed = await importer.parse(await readFile(SAMPLE));
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@indotek.test' } });
  const res = await importer.commit(parsed, admin.id);
  const counts = await prisma.project.findMany({
    select: { code: true, _count: { select: { clusters: true } } },
    orderBy: { code: 'asc' },
  });
  console.log(
    `Seed selesai. Cluster dibuat: ${res.created}, diperbarui: ${res.updated}. ` +
      counts.map((c) => `${c.code}=${c._count.clusters}`).join(', '),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
