export const ROLES = ['ADMIN', 'PM', 'FINANCE', 'DIREKTUR', 'INVESTOR'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  PM: 'Project Manager',
  FINANCE: 'Finance',
  DIREKTUR: 'Direktur',
  INVESTOR: 'Investor',
};

export const CLUSTER_STATUSES = ['PLAN', 'ONGOING', 'DONE', 'CANCELLED'] as const;
export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];
export const CLUSTER_STATUS_LABEL: Record<ClusterStatus, string> = {
  PLAN: 'Rencana',
  ONGOING: 'Berjalan',
  DONE: 'Selesai',
  CANCELLED: 'Batal',
};

export const DIVISIONS = ['IBK', 'TELCO'] as const;
export type Division = (typeof DIVISIONS)[number];

export const LINE_MODES = ['PCT', 'RP'] as const;
export type LineMode = (typeof LINE_MODES)[number];

/** Kode baris budget yang disimpan sebagai BudgetLine (urut sesuai sheet). */
export const BUDGET_LINE_CODES = [
  'SUBCON',
  'TICKET',
  'INDIRECT',
  'DIRECT',
  'OPS_KANTOR',
  'MOTOR_MOBIL',
  'HOMEBASE',
  'ALLOWANCE',
  'MARKETING',
] as const;
export type BudgetLineCode = (typeof BUDGET_LINE_CODES)[number];

/** Pos cost project (Bagian B form pengajuan). */
export const COST_PROJECT_CODES = [
  'INDIRECT',
  'DIRECT',
  'OPS_KANTOR',
  'MOTOR_MOBIL',
  'HOMEBASE',
  'ALLOWANCE',
  'MARKETING',
] as const satisfies readonly BudgetLineCode[];
export type CostProjectCode = (typeof COST_PROJECT_CODES)[number];

/** Pos pada form pengajuan dana. Bagian A = subcon, permit, ticket, pajak. */
export const FR_SECTION_A = ['SUBCON', 'PERMIT', 'TICKET', 'PAJAK'] as const;
export const FR_SECTION_B = COST_PROJECT_CODES;
export const FR_CODES = [...FR_SECTION_A, ...FR_SECTION_B] as const;
export type FrCode = (typeof FR_CODES)[number];

export const BUDGET_LABEL: Record<FrCode, string> = {
  SUBCON: 'Biaya Subcon',
  PERMIT: 'Biaya Permit',
  TICKET: 'Ticket Internal',
  PAJAK: 'Pajak',
  INDIRECT: 'Indirect Cost',
  DIRECT: 'Direct Cost',
  OPS_KANTOR: 'Operational Kantor',
  MOTOR_MOBIL: 'Motor dan Mobil',
  HOMEBASE: 'Homebase',
  ALLOWANCE: 'Allowance Kunjungan include ops permit',
  MARKETING: 'Marketing cost',
};

export const FR_DEFAULT_KETERANGAN: Partial<Record<FrCode, string>> = {
  SUBCON: 'Pembayaran subcon',
  PERMIT: 'Permit (pass-through)',
  TICKET: 'Tiket perjalanan',
  PAJAK: 'Pajak atas nilai proyek',
  DIRECT: 'Gaji/upah teknisi lapangan',
  MOTOR_MOBIL: 'Sewa/BBM kendaraan',
  ALLOWANCE: 'Termasuk ops permit',
};

export const FR_STATUSES = [
  'DRAFT',
  'DIAJUKAN',
  'DIPERIKSA_FINANCE',
  'DISETUJUI_DIREKTUR',
  'DIKETAHUI_INVESTOR',
  'DICAIRKAN',
  'DITOLAK',
] as const;
export type FrStatus = (typeof FR_STATUSES)[number];

export const FR_STATUS_LABEL: Record<FrStatus, string> = {
  DRAFT: 'Draft',
  DIAJUKAN: 'Diajukan',
  DIPERIKSA_FINANCE: 'Diperiksa Finance',
  DISETUJUI_DIREKTUR: 'Disetujui Direktur',
  DIKETAHUI_INVESTOR: 'Diketahui Investor',
  DICAIRKAN: 'Dicairkan',
  DITOLAK: 'Ditolak',
};

/** Status yang dananya sedang diproses (belum cair, sudah diajukan). */
export const FR_IN_PROCESS_STATUSES = [
  'DIAJUKAN',
  'DIPERIKSA_FINANCE',
  'DISETUJUI_DIREKTUR',
  'DIKETAHUI_INVESTOR',
] as const satisfies readonly FrStatus[];

export const ATTACHMENT_KINDS = [
  'PROYEKSI_BUDGET',
  'PO_SPK',
  'RENCANA_KERJA',
  'BOQ_PENAWARAN',
  'LAPORAN_TERMIN_SEBELUMNYA',
  'LAINNYA',
  'BUKTI_CAIR',
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_LABEL: Record<AttachmentKind, string> = {
  PROYEKSI_BUDGET: 'Proyeksi budget proyek',
  PO_SPK: 'PO / SPK dengan pemberi kerja',
  RENCANA_KERJA: 'Rencana kerja & jadwal pelaksanaan cluster',
  BOQ_PENAWARAN: 'Rincian material (BOQ) & penawaran vendor',
  LAPORAN_TERMIN_SEBELUMNYA: 'Laporan realisasi termin sebelumnya',
  LAINNYA: 'Lainnya',
  BUKTI_CAIR: 'Bukti pencairan',
};

/** Lampiran yang tampil sebagai checklist di form (BUKTI_CAIR tidak). */
export const FORM_ATTACHMENT_KINDS = ATTACHMENT_KINDS.filter((k) => k !== 'BUKTI_CAIR');

export const APPROVAL_STEPS = [
  'DIAJUKAN',
  'PERIKSA_FINANCE',
  'SETUJU_DIREKTUR',
  'MENGETAHUI_INVESTOR',
  'PENCAIRAN',
] as const;
export type ApprovalStep = (typeof APPROVAL_STEPS)[number];

export const APPROVAL_ACTIONS = ['APPROVE', 'REJECT'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
