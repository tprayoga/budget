import type {
  AgingType,
  AllocationMethod,
  ClientPaymentStatus,
  ExpenseCategory,
  ExpenseSource,
  ExpenseStatus,
  PoKind,
  TerminKind,
} from '@indotek/shared';
import type {
  AttachmentKind,
  BudgetLineCode,
  CalcSummaryDto,
  ClusterStatus,
  Division,
  FrAction,
  FrCode,
  FrStatus,
  LineMode,
  Role,
  ApprovalStep,
} from '@indotek/shared';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  jabatan: string | null;
  mustChangePassword: boolean;
  projectIds: string[];
}

export interface Client {
  id: string;
  name: string;
  /** PPN termin untuk client ini (null = ikut Setting global) */
  ppnRate?: string | null;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  year: number;
  clientId?: string;
  client: Client;
  _count?: { clusters: number };
}

export interface EffectiveSetting {
  interestRate: string;
  retensiAsCost: boolean;
  rekeningBank: string | null;
  rekeningNo: string | null;
  rekeningNama: string | null;
  realisasiWarnPct?: string;
  realisasiOverPct?: string;
  ppnRate?: string;
  overridden: string[];
}

export interface BudgetLine {
  code: BudgetLineCode;
  label: string;
  mode: LineMode;
  pct: string | null;
  amount: string | null;
}

export interface Cluster {
  id: string;
  projectId: string;
  name: string;
  info: string | null;
  division: Division | null;
  status: ClusterStatus;
  sortOrder: number;
  nilaiPoImpl: string;
  nilaiPoPermit: string;
  permitCost: string;
  /** Σ PO PERMIT saja (dasar margin permit, tanpa SND) */
  permitPoAmount?: string;
  note?: string | null;
  terminOffset?: number;
  pajakRate: string;
  retensiRate: string;
  implementationDate?: string | null;
  lines: BudgetLine[];
}

export interface ClusterWithCalc extends Cluster {
  calc: CalcSummaryDto;
  realisasi?: RealisasiSummary;
}

export interface ProjectBudget {
  project: Project;
  setting: EffectiveSetting;
  clusters: ClusterWithCalc[];
  total: CalcSummaryDto;
}

export interface OverrunItem {
  clusterId: string;
  clusterName: string;
  projectId: string;
  projectCode: string;
  code: FrCode | 'TOTAL';
  label: string;
  budget: string;
  realisasi: string;
  pctTerpakai: string;
  threshold: string;
}

export interface Rekap {
  global: EffectiveSetting;
  projects: ProjectBudget[];
  grandTotal: CalcSummaryDto;
  overBudget?: OverrunItem[];
}

export interface ClusterPo {
  id: string;
  clusterId: string;
  kind: PoKind;
  /** CLUSTER / SUBFEEDER untuk PO implementasi yang dipecah */
  subKind?: string | null;
  poNumber: string | null;
  poDate: string | null;
  amount: string;
  passThroughCost: string;
  note: string | null;
  sourceRef: string | null;
}

export interface FieldOverrideInfo {
  field: string;
  userId: string | null;
  reason: string | null;
  at: string;
}

export interface UsageRow {
  code: FrCode;
  label: string;
  budget: string;
  sudahDicairkan: string;
  sedangDiproses: string;
  realisasiTanpaPengajuan?: string;
  sisa: string;
}

export interface ClusterDetail extends ClusterWithCalc {
  project: { id: string; code: string; name: string; client: Client };
  setting: EffectiveSetting;
  usage: UsageRow[];
  pos: ClusterPo[];
  overrides: FieldOverrideInfo[];
  nextTerminKe: number;
  fundRequests: {
    id: string;
    number: string | null;
    status: FrStatus;
    terminKe: number;
    tanggal: string;
    totalDiajukan: string;
    diajukanOleh: string;
  }[];
}

export interface FrListItem {
  id: string;
  number: string | null;
  label: string;
  status: FrStatus;
  terminKe: number;
  tanggal: string;
  totalDiajukan: string;
  cluster: { id: string; name: string };
  project: { id: string; code: string; name: string };
  diajukanOleh: { id: string; name: string };
  submittedAt: string | null;
  updatedAt: string;
  allowedActions: FrAction[];
}

export interface FrLine {
  budgetCode: FrCode;
  label: string;
  section: 'A' | 'B';
  budgetAmount: string;
  pctNilaiProyek: string;
  pctCair: string;
  diajukan: string;
  sudahDicairkanSebelum: string;
  sedangDiproses: string;
  /** Realisasi terverifikasi pos ini yang tidak ditautkan ke pengajuan (mis. sebelum sistem). */
  realisasiTanpaPengajuan: string;
  /** sudahDicairkanSebelum + realisasiTanpaPengajuan */
  sudahTerpakai: string;
  /** ROUND(budget) − sudah cair − sedang diproses − realisasi tanpa pengajuan */
  sisaTersedia: string;
  /** % cair "sisa budget" (rasio, dibulatkan ke bawah 0,01%) */
  pctSisa: string;
  habis: boolean;
  sisaBudget: string;
  sisaSetelahProses: string;
  penyesuaianPembulatan: boolean;
  overBudget: boolean;
  keterangan: string | null;
}

export interface FrTotals {
  budgetAmount: string;
  pctNilaiProyek: string;
  diajukan: string;
  sudahDicairkanSebelum: string;
  sedangDiproses: string;
  realisasiTanpaPengajuan: string;
  sudahTerpakai: string;
  sisaTersedia: string;
  sisaBudget: string;
}

export interface Signature {
  name: string;
  jabatan: string | null;
  at: string | null;
}

export interface FrAttachment {
  id: string;
  kind: AttachmentKind;
  label: string | null;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  hasFile: boolean;
  checked: boolean;
  createdAt: string;
}

export interface FrBatasCluster {
  budget: string;
  terpakai: string;
  overPos: string;
  sisaCluster: string;
  diajukan: string;
  exceeded: boolean;
  penyesuaian: boolean;
}

export interface FrDetail {
  id: string;
  batasCluster: FrBatasCluster;
  /** Draft dihitung ulang otomatis (mis. karena realisasi sebelumnya) — tampil sebagai banner. */
  recalcNote: string | null;
  number: string | null;
  label: string;
  status: FrStatus;
  live: boolean;
  terminKe: number;
  tanggal: string;
  periode: string | null;
  diajukanKepada: string;
  justifikasi: string;
  rekeningBank: string | null;
  rekeningNo: string | null;
  rekeningNama: string | null;
  cluster: { id: string; name: string; info: string | null };
  project: { id: string; code: string; name: string };
  client: Client;
  diajukanOleh: { id: string; name: string; jabatan: string | null };
  snapshot: {
    nilaiProyek: string;
    interestRate: string;
    retensiAsCost: boolean;
    infoBunga: string;
    infoRetensi: string;
    infoProfit: string;
    infoMargin: string;
    terminKe: number;
  };
  lines: FrLine[];
  subtotalA: FrTotals;
  subtotalB: FrTotals;
  total: FrTotals;
  terbilang: string;
  overBudgetCodes: FrCode[];
  approvals: {
    id: string;
    step: ApprovalStep;
    action: 'APPROVE' | 'REJECT';
    note: string | null;
    at: string;
    user: { id: string; name: string; role: Role; jabatan: string | null };
  }[];
  signatures: Record<ApprovalStep, Signature | null>;
  attachments: FrAttachment[];
  submittedAt: string | null;
  cairTanggal: string | null;
  cairBuktiAttachmentId: string | null;
  overrideReason: string | null;
  overrideBy: { id: string; name: string } | null;
  rejectedNote: string | null;
  allowedActions: FrAction[];
}

export interface Inbox {
  count: number;
  items: FrListItem[];
}

// ---------------------------------------------------------------- Fase 2: realisasi


export interface Expense {
  id: string;
  project: { id: string; code: string; name: string };
  cluster: { id: string; name: string } | null;
  date: string | null;
  periodLabel: string | null;
  category: ExpenseCategory;
  budgetCode: FrCode;
  description: string;
  amount: string;
  clusterAmount: string | null;
  termin: string | null;
  vendor: string | null;
  invoiceNo: string | null;
  hasAttachment: boolean;
  attachmentName: string | null;
  fundRequest: { id: string; number: string | null; status: FrStatus } | null;
  status: ExpenseStatus;
  source: ExpenseSource;
  allocationMethod: AllocationMethod | null;
  allocations: { clusterId: string; clusterName: string; amount: string; pct: string }[];
  rejectNote: string | null;
  note: string | null;
  createdBy: { id: string; name: string } | null;
  apiKey: { id: string; name: string } | null;
  verifiedBy: { id: string; name: string } | null;
  verifiedAt: string | null;
  createdAt: string;
  locked: boolean;
}

export interface RealizationRow {
  code: FrCode;
  budget: string;
  realisasi: string;
  sisa: string;
  pctTerpakai: string;
  level: 'ok' | 'warn' | 'over';
  menungguVerifikasi: string;
}

export interface ClusterRealization {
  clusterId: string;
  warnPct: string;
  rows: RealizationRow[];
  total: Omit<RealizationRow, 'code'>;
  byCategory: { category: ExpenseCategory; realisasi: string }[];
  profit: {
    nilaiProyek: string;
    proyeksiProfit: string;
    pembayaranBruto: string;
    kasDiterima: string;
    realisasiBiaya: string;
    profitRealisasi: string;
  };
}

export interface ClientPayment {
  id: string;
  clusterId: string;
  poId: string | null;
  fromTemplate: boolean;
  /** Termin sudah ditagih / punya no. invoice / manual, tetapi tanggal invoice kosong. */
  needsInvoiceDate: boolean;
  /** Dibayar (referensi RAB) tetapi tanggal diterima kosong. */
  needsPaidDate: boolean;
  kind: TerminKind;
  termin: number;
  pct: string | null;
  /** DPP */
  amount: string;
  ppnRate: string;
  pphRate: string;
  ppnAmount: string;
  pphAmount: string;
  invoiceTotal: string;
  expectedNet: string;
  keterangan: string | null;
  /** Termin retensi: N bulan setelah tanggal opname */
  retentionMonths?: number | null;
  opnameDate?: string | null;
  retentionReleaseDate?: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  paidDate: string | null;
  paidAmount: string | null;
  potongan: string;
  status: ClientPaymentStatus;
}

export interface ClientInvoiceRef {
  id: string;
  sourceRef: string;
  clusterId: string | null;
  blockTitle: string | null;
  termin: number | null;
  invoiceNo: string;
  netAmount: string | null;
  dueDate: string | null;
  statusText: string | null;
  paid: boolean;
  appliedPaymentId: string | null;
  appliedAt: string | null;
  suggestion: { mode: 'NET' | 'DPP'; basis?: 'NET_PAID' | 'INVOICE' | 'DPP'; perluKonfirmasiPajak: boolean; paymentId: string; clusterId: string; clusterName: string; kind: TerminKind; termin: number; expectedNet: string; selisih: string } | null;
  ambiguous: boolean;
}

export interface ClientPaymentsResponse {
  pos: ClusterPo[];
  payments: ClientPayment[];
  templates: { kind: TerminKind; agingDays: number | null; agingType: AgingType | null; lines: number }[];
  invoiceRefs: ClientInvoiceRef[];
  missingInvoiceDate: number;
  totals: { dpp: string; ppn: string; ppnTitipan: string };
}

export interface AppNotification {
  id: string;
  type: string;
  key: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface MissingInvoiceDate {
  id: string;
  clusterId: string;
  clusterName: string;
  projectCode: string;
  kind: TerminKind;
  termin: number;
  poNumber: string | null;
  invoiceNo: string | null;
  amount: string;
  status: ClientPaymentStatus;
  missing: 'INVOICE' | 'PAID';
}

export interface FrUsage {
  dicairkan: boolean;
  rows: { code: FrCode; cair: string; realisasi: string; sisa: string }[];
  total: { cair: string; realisasi: string; sisa: string };
  menungguVerifikasi: number;
  cairTanggal: string | null;
  expenses: {
    id: string;
    date: string | null;
    category: ExpenseCategory;
    description: string;
    status: ExpenseStatus;
    amount: string;
    clusterAmount: string | null;
  }[];
}

export interface RealisasiSummary {
  realisasiBiaya: string;
  menungguVerifikasi: string;
  pembayaranBruto: string;
  kasDiterima: string;
  ppnTitipan?: string;
  profitRealisasi: string;
}

export interface IncompletePaymentGroup {
  projectId: string;
  projectCode: string;
  count: number;
  total: string;
  items: (ClientPayment & {
    clusterName: string;
    clusterStatus: string;
    implementationDate: string | null;
    poNumber: string | null;
    poSubKind: string | null;
    reasons: string[];
  })[];
}
