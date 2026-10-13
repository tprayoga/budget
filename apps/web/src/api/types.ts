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
  pajakRate: string;
  retensiRate: string;
  lines: BudgetLine[];
}

export interface ClusterWithCalc extends Cluster {
  calc: CalcSummaryDto;
}

export interface ProjectBudget {
  project: Project;
  setting: EffectiveSetting;
  clusters: ClusterWithCalc[];
  total: CalcSummaryDto;
}

export interface Rekap {
  global: EffectiveSetting;
  projects: ProjectBudget[];
  grandTotal: CalcSummaryDto;
}

export interface UsageRow {
  code: FrCode;
  label: string;
  budget: string;
  sudahDicairkan: string;
  sedangDiproses: string;
  sisa: string;
}

export interface ClusterDetail extends ClusterWithCalc {
  project: { id: string; code: string; name: string; client: Client };
  setting: EffectiveSetting;
  usage: UsageRow[];
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

export interface FrDetail {
  id: string;
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
