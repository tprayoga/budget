import { z } from 'zod';
import {
  PO_KINDS,
  AGING_TYPES,
  ALLOCATION_METHODS,
  CLIENT_PAYMENT_STATUSES,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  TERMIN_KINDS,
  ATTACHMENT_KINDS,
  BUDGET_LINE_CODES,
  CLUSTER_STATUSES,
  DIVISIONS,
  FR_CODES,
  FR_STATUSES,
  LINE_MODES,
  ROLES,
} from '../enums';

/** Desimal dalam bentuk string/number → string desimal yang valid. */
export const zDecimal = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: 'Angka tidak valid' });

export const zNonNegDecimal = zDecimal.refine((v) => !v.startsWith('-'), { message: 'Tidak boleh negatif' });

/** Rasio 0..1 (persen disimpan sebagai rasio). */
export const zRate = zNonNegDecimal.refine((v) => Number(v) <= 10, { message: 'Rasio terlalu besar' });

export const loginSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Kebijakan password: minimal 10 karakter, berisi huruf dan angka. */
export const passwordPolicy = z
  .string()
  .min(10, 'Minimal 10 karakter')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Harus mengandung huruf dan angka');

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Wajib diisi'), newPassword: passwordPolicy })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'Password baru harus berbeda', path: ['newPassword'] });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const clientSchema = z.object({ name: z.string().trim().min(2).max(120) });

export const projectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_]+$/, 'Kode hanya huruf kapital/angka/underscore'),
  name: z.string().trim().min(2).max(160),
  clientId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
});
export const projectUpdateSchema = projectSchema.partial();

export const budgetLineSchema = z
  .object({
    code: z.enum(BUDGET_LINE_CODES),
    mode: z.enum(LINE_MODES),
    pct: zRate.nullish(),
    amount: zNonNegDecimal.nullish(),
  })
  .refine((l) => (l.mode === 'PCT' ? l.pct != null : l.amount != null), {
    message: 'Mode PCT wajib isi pct, mode RP wajib isi amount',
  });
export type BudgetLineDto = z.infer<typeof budgetLineSchema>;

export const clusterBaseSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  info: z.string().trim().max(500).nullish(),
  division: z.enum(DIVISIONS).nullish(),
  status: z.enum(CLUSTER_STATUSES).default('PLAN'),
  nilaiPoImpl: zNonNegDecimal,
  nilaiPoPermit: zNonNegDecimal.default('0'),
  permitCost: zNonNegDecimal.default('0'),
  pajakRate: zRate.optional(),
  retensiRate: zRate.optional(),
  implementationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD')
    .nullish(),
});
export const clusterCreateSchema = clusterBaseSchema.extend({
  lines: z.array(budgetLineSchema).optional(),
});
export const clusterUpdateSchema = clusterBaseSchema.omit({ projectId: true }).partial().extend({
  lines: z.array(budgetLineSchema).optional(),
});
export type ClusterCreateInput = z.infer<typeof clusterCreateSchema>;
export type ClusterUpdateInput = z.infer<typeof clusterUpdateSchema>;

export const clusterDuplicateSchema = z.object({ name: z.string().trim().min(2).max(200) });

/** Setting project: null = kembali ikut setting global. */
export const settingSchema = z.object({
  interestRate: zRate.nullish(),
  retensiAsCost: z.boolean().nullish(),
  rekeningBank: z.string().trim().max(80).nullish(),
  rekeningNo: z.string().trim().max(40).nullish(),
  rekeningNama: z.string().trim().max(120).nullish(),
  realisasiWarnPct: zRate.refine((v) => Number(v) > 0 && Number(v) <= 1, { message: 'Antara 0 dan 100%' }).nullish(),
  realisasiOverPct: zRate.refine((v) => Number(v) > 0 && Number(v) <= 5, { message: 'Antara 0 dan 500%' }).nullish(),
});
export type SettingInput = z.infer<typeof settingSchema>;
/** Setting global: interestRate & retensiAsCost tidak boleh null. */
export const settingGlobalSchema = settingSchema.extend({
  interestRate: zRate.optional(),
  retensiAsCost: z.boolean().optional(),
});

export const templateSchema = z.object({
  pajakRate: zRate.nullish(),
  retensiRate: zRate.nullish(),
  lines: z.array(budgetLineSchema).optional(),
});
export type TemplateInput = z.infer<typeof templateSchema>;

export const frLineInputSchema = z.object({
  budgetCode: z.enum(FR_CODES),
  pctCair: zRate.refine((v) => Number(v) <= 1, { message: 'Maksimal 100%' }),
  keterangan: z.string().trim().max(300).nullish(),
});

export const frCreateSchema = z.object({
  clusterId: z.string().min(1),
  tanggal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD')
    .optional(),
  periode: z.string().trim().max(100).nullish(),
  diajukanKepada: z.string().trim().max(120).default('Investor'),
  justifikasi: z.string().trim().max(2000).nullish(),
  rekeningBank: z.string().trim().max(80).nullish(),
  rekeningNo: z.string().trim().max(40).nullish(),
  rekeningNama: z.string().trim().max(120).nullish(),
  lines: z.array(frLineInputSchema).optional(),
  override: z.boolean().optional(),
  overrideReason: z.string().trim().max(500).nullish(),
});
export type FrCreateInput = z.infer<typeof frCreateSchema>;
export const frUpdateSchema = frCreateSchema.omit({ clusterId: true }).partial();
export type FrUpdateInput = z.infer<typeof frUpdateSchema>;

export const frSubmitSchema = z.object({
  override: z.boolean().optional(),
  overrideReason: z.string().trim().max(500).nullish(),
});

export const frDecisionSchema = z.object({ note: z.string().trim().max(1000).nullish() });
export const frRejectSchema = z.object({ note: z.string().trim().min(3, 'Alasan penolakan wajib diisi').max(1000) });

export const frDisburseSchema = z.object({
  cairTanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(1000).nullish(),
});

export const frListQuerySchema = z.object({
  status: z.enum(FR_STATUSES).optional(),
  projectId: z.string().optional(),
  clusterId: z.string().optional(),
  q: z.string().optional(),
});

export const attachmentKindSchema = z.enum(ATTACHMENT_KINDS);

export const userCreateSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email(),
  password: passwordPolicy,
  role: z.enum(ROLES),
  jabatan: z.string().trim().max(120).nullish(),
  projectIds: z.array(z.string()).optional(),
});

export const importCommitSchema = z.object({
  /** Kunci cluster yang di-commit: "{PROJECT_CODE}::{nama cluster}". Kosong = semua yang berubah/baru. */
  keys: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------- Fase 2: realisasi

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD');

export const manualAllocationSchema = z.object({ clusterId: z.string().min(1), amount: zNonNegDecimal });

/**
 * Expense level cluster: isi `clusterId`. Level project: `clusterId` null + `clusterIds` (kosong = semua cluster
 * aktif project) + `allocationMethod` (EQUAL / PRO_RATA_PO / MANUAL dengan `manualAllocations`).
 */
export const expenseBaseSchema = z.object({
  projectId: z.string().min(1).optional(),
  clusterId: z.string().min(1).nullish(),
  clusterIds: z.array(z.string().min(1)).optional(),
  allocationMethod: z.enum(ALLOCATION_METHODS).nullish(),
  manualAllocations: z.array(manualAllocationSchema).optional(),
  date: zDate,
  category: z.enum(EXPENSE_CATEGORIES),
  budgetCode: z.enum(FR_CODES).nullish(),
  description: z.string().trim().min(2, 'Keterangan wajib diisi').max(500),
  amount: zNonNegDecimal.refine((v) => Number(v) > 0, { message: 'Nominal harus > 0' }),
  termin: z.string().trim().max(60).nullish(),
  vendor: z.string().trim().max(160).nullish(),
  invoiceNo: z.string().trim().max(80).nullish(),
  fundRequestId: z.string().nullish(),
  /** MOBILE = input cepat dari HP */
  source: z.enum(['MANUAL', 'MOBILE']).optional(),
});
export const expenseCreateSchema = expenseBaseSchema.refine((v) => v.clusterId || v.projectId, {
  message: 'Pilih cluster atau project',
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export const expenseUpdateSchema = expenseBaseSchema.partial();
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;

export const expenseListQuerySchema = z.object({
  projectId: z.string().optional(),
  clusterId: z.string().optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  fundRequestId: z.string().optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  q: z.string().optional(),
});

export const expenseRejectSchema = z.object({ note: z.string().trim().min(3, 'Alasan wajib diisi').max(500) });
export const expenseLinkSchema = z.object({ fundRequestId: z.string().nullable() });

export const clientPaymentUpdateSchema = z.object({
  amount: zNonNegDecimal.optional(),
  keterangan: z.string().trim().max(300).nullish(),
  invoiceNo: z.string().trim().max(80).nullish(),
  invoiceDate: zDate.nullish(),
  /** hanya dipakai bila template tidak punya aging */
  dueDate: zDate.nullish(),
  paidDate: zDate.nullish(),
  paidAmount: zNonNegDecimal.nullish(),
  status: z.enum(CLIENT_PAYMENT_STATUSES).optional(),
});
export type ClientPaymentUpdateInput = z.infer<typeof clientPaymentUpdateSchema>;

export const clientPaymentCreateSchema = z.object({
  poId: z.string().min(1),
  kind: z.enum(TERMIN_KINDS),
  termin: z.number().int().min(1).max(20),
  amount: zNonNegDecimal,
  pct: zRate.nullish(),
  keterangan: z.string().trim().max(300).nullish(),
});

export const terminTemplateSchema = z.object({
  clientId: z.string().min(1),
  kind: z.enum(TERMIN_KINDS),
  agingDays: z.number().int().min(0).max(365).nullable(),
  agingType: z.enum(AGING_TYPES).nullable(),
  lines: z
    .array(z.object({ pct: zRate, keterangan: z.string().trim().max(300).nullish() }))
    .min(1)
    .refine((ls) => Math.abs(ls.reduce((a, l) => a + Number(l.pct), 0) - 1) < 1e-9, { message: 'Total persentase termin harus 100%' }),
});

export const categoryMappingSchema = z.array(
  z.object({ category: z.enum(EXPENSE_CATEGORIES), budgetCode: z.enum(FR_CODES).nullable() }),
);

export const holidaySchema = z.object({ date: zDate, name: z.string().trim().min(2).max(120) });

export const apiKeyCreateSchema = z.object({ name: z.string().trim().min(2).max(80) });

/** Webhook bot (Telegram/n8n). Foto via multipart `foto` atau JSON `fotoBase64` (boleh data URL). */
export const webhookExpenseSchema = z.object({
  cluster: z.string().trim().min(1),
  kategori: z.string().trim().min(2),
  nominal: zNonNegDecimal.refine((v) => Number(v) > 0, { message: 'Nominal harus > 0' }),
  tanggal: zDate,
  keterangan: z.string().trim().max(500).nullish(),
  externalId: z.string().trim().max(120).nullish(),
  fotoBase64: z.string().max(8_000_000).nullish(),
  fotoNama: z.string().trim().max(120).nullish(),
});
export type WebhookExpenseInput = z.infer<typeof webhookExpenseSchema>;

/** Porsi alokasi manual per cluster (rasio 0..1, Σ = 1) untuk grup import. */
export const manualPctSchema = z.object({ clusterId: z.string().min(1), pct: zRate });

/**
 * Keputusan pemetaan import RAB, per kunci grup/blok atau per item.
 * INHERIT = hanya menetapkan kategori; tujuan cluster mengikuti keputusan grup.
 * HOLD = ditahan (perlu konfirmasi, bisa dilepas kemudian); DUPLICATE = duplikat (dilewati); SKIP = dilewati.
 */
export const RAB_SCOPES = ['CLUSTER', 'PROJECT', 'SKIP', 'INHERIT', 'HOLD', 'DUPLICATE'] as const;
export const rabDecisionSchema = z
  .object({
    scope: z.enum(RAB_SCOPES),
    clusterId: z.string().nullish(),
    clusterIds: z.array(z.string()).optional(),
    method: z.enum(ALLOCATION_METHODS).nullish(),
    manualPcts: z.array(manualPctSchema).optional(),
    /** IMPL_DATE_LE_EXPENSE: penerima = cluster dengan tanggal implementasi ≤ tanggal expense (kosong ikut) */
    clusterFilter: z.enum(['IMPL_DATE_LE_EXPENSE']).nullish(),
    category: z.enum(EXPENSE_CATEGORIES).nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((d) => d.method !== 'MANUAL' || (d.manualPcts?.length ?? 0) > 0, { message: 'Alokasi manual wajib persentase per cluster' })
  .refine((d) => d.method !== 'MANUAL' || Math.abs((d.manualPcts ?? []).reduce((a, x) => a + Number(x.pct), 0) - 1) < 1e-9, {
    message: 'Total persentase alokasi manual harus 100%',
  });

/** Lepas item yang ditahan: tentukan tujuan & kategori. */
export const heldReleaseSchema = z.object({
  scope: z.enum(['CLUSTER', 'PROJECT']),
  clusterId: z.string().nullish(),
  clusterIds: z.array(z.string()).optional(),
  method: z.enum(ALLOCATION_METHODS).nullish(),
  manualPcts: z.array(manualPctSchema).optional(),
  category: z.enum(EXPENSE_CATEGORIES),
  note: z.string().trim().max(500).nullish(),
});
export type HeldReleaseInput = z.infer<typeof heldReleaseSchema>;
export const heldDismissSchema = z.object({ scope: z.enum(['SKIP', 'DUPLICATE']), note: z.string().trim().min(3).max(500) });
export type RabDecision = z.infer<typeof rabDecisionSchema>;
export const rabCommitSchema = z.object({ decisions: z.record(rabDecisionSchema).optional() });

// ---------------------------------------------------------------- Fase 2.3

const zSignedDecimal = zDecimal;

export const clusterPoSchema = z
  .object({
    kind: z.enum(PO_KINDS),
    poNumber: z.string().trim().max(120).nullish(),
    poDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
    amount: zSignedDecimal,
    passThroughCost: zNonNegDecimal.default('0'),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((p) => (p.kind === 'DEDUCTION' ? Number(p.amount) <= 0 : Number(p.amount) >= 0), {
    message: 'Deduction harus negatif; jenis PO lain tidak boleh negatif',
    path: ['amount'],
  });
export type ClusterPoInput = z.infer<typeof clusterPoSchema>;
export const clusterPoUpdateSchema = z.object({
  poNumber: z.string().trim().max(120).nullish(),
  poDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  amount: zSignedDecimal.optional(),
  passThroughCost: zNonNegDecimal.optional(),
  note: z.string().trim().max(500).nullish(),
});
export type ClusterPoUpdateInput = z.infer<typeof clusterPoUpdateSchema>;

/** Terapkan referensi tagihan RAB ke termin: bruto diisi FINANCE; paidAmount = nilai net referensi. */
export const applyInvoiceRefSchema = z.object({
  refId: z.string().min(1),
  amount: zNonNegDecimal.refine((v) => Number(v) > 0, { message: 'Bruto harus > 0' }),
  paidDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});
export type ApplyInvoiceRefInput = z.infer<typeof applyInvoiceRefSchema>;
