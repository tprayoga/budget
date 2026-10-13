import { z } from 'zod';
import {
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
