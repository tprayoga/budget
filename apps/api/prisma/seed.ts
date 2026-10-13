/* Seed data demo Fase 1: setting & template default, client, project, user per role, cluster dari file contoh. */
import { PrismaClient, type BudgetCode, type ExpenseCategory, type FrCode, type Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AuditService } from '../src/audit/audit.service';
import { BudgetImporter } from '../src/import/budget-importer';
import { generateClientPayments } from '../src/realization/termin-generator';
import { seedDefaultRabRules } from '../src/import/default-rab-rules';
import { applyPatch22 } from '../src/import/patch-2-2';
import { applyPatch23 } from '../src/import/patch-2-3';
import { applyPatch24 } from '../src/import/patch-2-4';
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

/** Mapping default kategori realisasi → pos budget (bisa diubah di menu Pengaturan). */
const DEFAULT_CATEGORY_MAPPING: Record<ExpenseCategory, FrCode | null> = {
  SUBCON_JASA: 'SUBCON',
  SUBCON_MATERIAL: 'SUBCON',
  MATERIAL_PEMBELIAN: 'SUBCON',
  PERMIT: 'PERMIT',
  OPS: 'OPS_KANTOR',
  PJD: 'ALLOWANCE',
  TICKET: 'TICKET',
  HOMEBASE: 'HOMEBASE',
  MOTOR_MOBIL: 'MOTOR_MOBIL',
  PAJAK: 'PAJAK',
  MARKETING_FEE: 'MARKETING',
  LAINNYA: null,
};

/** Template termin pembayaran klien. CCSI belum punya template (termin diinput manual). */
const TERMIN_TEMPLATES: {
  client: string;
  kind: 'IMPLEMENTASI' | 'PERMIT';
  agingDays: number | null;
  agingType: 'CALENDAR' | 'WORKING' | null;
  lines: [string, string][];
}[] = [
  {
    client: 'PT ADW',
    kind: 'IMPLEMENTASI',
    agingDays: null,
    agingType: null,
    lines: [
      ['0.8', 'Progress 100%'],
      ['0.1', 'After Clear Punchlist Customer, ATP'],
      ['0.1', 'Retensi 2 bulan after ATP/BAST, BAPS'],
    ],
  },
  {
    client: 'PT Evantama Network System',
    kind: 'IMPLEMENTASI',
    agingDays: 30,
    agingType: 'CALENDAR',
    lines: [
      ['0.2', 'Melampirkan PO dan foto di lapangan'],
      ['0.3', 'CWC dan OPMC'],
      ['0.4', 'RFSC'],
      ['0.1', 'FAC/Retention'],
    ],
  },
  {
    client: 'PT Evantama Network System',
    kind: 'PERMIT',
    agingDays: 14,
    agingType: 'WORKING',
    lines: [
      ['0.5', 'Setelah PO release (kuitansi, BA serah terima, foto)'],
      ['0.5', 'Setelah RFS Permit ditandatangani'],
    ],
  },
];

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

const SAMPLE = path.resolve(__dirname, '../../../docs/samples/Budget_Per_Cluster_ADW_Evantama_CCSI.sample.xlsx');

/**
 * Production: tidak ada user demo. Admin awal dibuat dari INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD
 * (hanya bila belum ada ADMIN), dan wajib ganti password saat login pertama.
 */
async function ensureInitialAdmin() {
  if (await prisma.user.count({ where: { role: 'ADMIN' } })) return;
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const pass = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !pass) {
    console.warn('Production: belum ada ADMIN. Set INITIAL_ADMIN_EMAIL & INITIAL_ADMIN_PASSWORD lalu jalankan seed.');
    return;
  }
  await prisma.user.create({
    data: { email, name: 'Administrator', role: 'ADMIN', passwordHash: await bcrypt.hash(pass, 10), mustChangePassword: true },
  });
}

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
        // Fase 2.3: retensi = piutang (bukan biaya) — default resmi
        retensiAsCost: false,
        realisasiOverPct: '1',
        ppnRate: '0.11',
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

  // Fase 2: ambang kuning realisasi, mapping kategori, template termin (insert-only)
  await prisma.setting.updateMany({ where: { projectId: null, realisasiWarnPct: null }, data: { realisasiWarnPct: '0.8' } });
  await prisma.setting.updateMany({ where: { projectId: null, realisasiOverPct: null }, data: { realisasiOverPct: '1' } });
  await prisma.setting.updateMany({ where: { projectId: null, ppnRate: null }, data: { ppnRate: '0.11' } });
  for (const [category, budgetCode] of Object.entries(DEFAULT_CATEGORY_MAPPING)) {
    const exists = await prisma.categoryMapping.findFirst({ where: { projectId: null, category: category as ExpenseCategory } });
    if (!exists) await prisma.categoryMapping.create({ data: { projectId: null, category: category as ExpenseCategory, budgetCode } });
  }
  for (const t of TERMIN_TEMPLATES) {
    const client = await prisma.client.findUniqueOrThrow({ where: { name: t.client } });
    const exists = await prisma.terminTemplate.findUnique({ where: { clientId_kind: { clientId: client.id, kind: t.kind } } });
    if (exists) continue;
    await prisma.terminTemplate.create({
      data: {
        clientId: client.id,
        kind: t.kind,
        agingDays: t.agingDays,
        agingType: t.agingType,
        lines: { create: t.lines.map(([pct, keterangan], i) => ({ terminKe: i + 1, pct, keterangan })) },
      },
    });
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

  const production = process.env.NODE_ENV === 'production';
  if (!production) {
    // User demo hanya untuk non-production; semuanya wajib ganti password saat login pertama
    const passwordHash = await bcrypt.hash(password, 10);
    for (const u of USERS) {
      const user = await prisma.user.upsert({
        where: { email: u.email },
        create: { email: u.email, name: u.name, role: u.role, jabatan: u.jabatan, passwordHash, mustChangePassword: true },
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
  } else {
    await ensureInitialAdmin();
  }

  if (production && process.env.SEED_SAMPLE_CLUSTERS !== 'true') {
    for (const c of await prisma.cluster.findMany({ select: { id: true } })) await generateClientPayments(prisma, c.id);
    console.log('Seed selesai (production): master data saja; cluster contoh tidak diimpor.');
    return;
  }

  // Cluster dari file contoh: hanya cluster yang BELUM ada (seed jalan di setiap start container,
  // jadi tidak boleh menimpa perubahan user; pembaruan dari Excel lewat menu Import).
  const importer = new BudgetImporter(prisma, audit, settings);
  const parsed = await importer.parse(await readFile(SAMPLE));
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  const preview = await importer.preview(parsed);
  const newKeys = preview.clusters.filter((c) => c.status === 'NEW').map((c) => c.key);
  const res = newKeys.length ? await importer.commit(parsed, admin?.id ?? null, newKeys) : { created: 0, updated: 0 };
  // Backfill termin klien untuk cluster yang belum punya (insert-only)
  let termins = 0;
  for (const c of await prisma.cluster.findMany({ select: { id: true } })) termins += await generateClientPayments(prisma, c.id);
  if (termins) console.log(`Termin klien dibuat: ${termins}`);
  const rules = await seedDefaultRabRules(prisma, admin?.id ?? null);
  if (rules) console.log(`Aturan pemetaan import RAB default dibuat: ${rules}`);
  const patch = await applyPatch22(prisma, audit, admin?.id ?? null);
  if (patch.length) console.log(`Patch keputusan 2.2: ${patch.join('; ')}`);
  const patch23 = await applyPatch23(prisma, audit, admin?.id ?? null);
  if (patch23.length) console.log(`Patch keputusan 2.3: ${patch23.join('; ')}`);
  const patch24 = await applyPatch24(prisma, audit, admin?.id ?? null);
  if (patch24.length) console.log(`Patch keputusan 2.4: ${patch24.join('; ')}`);

  const counts = await prisma.project.findMany({
    select: { code: true, _count: { select: { clusters: true } } },
    orderBy: { code: 'asc' },
  });
  console.log(
    `Seed selesai. Cluster baru dari file contoh: ${res.created}. ` +
      counts.map((c) => `${c.code}=${c._count.clusters}`).join(', '),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
