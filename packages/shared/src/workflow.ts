import type { ApprovalStep, FrStatus, Role } from './enums';

export type FrAction = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'DISBURSE' | 'REVISE';

interface StepDef {
  from: FrStatus;
  /** Role yang berwenang di langkah ini. */
  role: Role;
  step: ApprovalStep;
  /** Status setelah disetujui. */
  next: FrStatus;
  canReject: boolean;
  label: string;
}

/**
 * Alur approval: PM ajukan → FINANCE periksa → DIREKTUR setujui → INVESTOR mengetahui → FINANCE cairkan.
 * Penolakan di langkah periksa/setujui/mengetahui → DITOLAK; PM dapat merevisi → DRAFT.
 */
export const FR_FLOW: StepDef[] = [
  { from: 'DRAFT', role: 'PM', step: 'DIAJUKAN', next: 'DIAJUKAN', canReject: false, label: 'Ajukan' },
  {
    from: 'DIAJUKAN',
    role: 'FINANCE',
    step: 'PERIKSA_FINANCE',
    next: 'DIPERIKSA_FINANCE',
    canReject: true,
    label: 'Periksa (Finance)',
  },
  {
    from: 'DIPERIKSA_FINANCE',
    role: 'DIREKTUR',
    step: 'SETUJU_DIREKTUR',
    next: 'DISETUJUI_DIREKTUR',
    canReject: true,
    label: 'Setujui (Direktur)',
  },
  {
    from: 'DISETUJUI_DIREKTUR',
    role: 'INVESTOR',
    step: 'MENGETAHUI_INVESTOR',
    next: 'DIKETAHUI_INVESTOR',
    canReject: true,
    label: 'Mengetahui (Investor)',
  },
  {
    from: 'DIKETAHUI_INVESTOR',
    role: 'FINANCE',
    step: 'PENCAIRAN',
    next: 'DICAIRKAN',
    canReject: false,
    label: 'Tandai Dicairkan',
  },
];

export const APPROVAL_STEP_LABEL: Record<ApprovalStep, string> = {
  DIAJUKAN: 'Diajukan oleh',
  PERIKSA_FINANCE: 'Diperiksa oleh (Finance)',
  SETUJU_DIREKTUR: 'Disetujui oleh (Direktur)',
  MENGETAHUI_INVESTOR: 'Mengetahui (Investor)',
  PENCAIRAN: 'Dicairkan oleh (Finance)',
};

/** Langkah aktif untuk status tertentu (null bila final). */
export function currentStep(status: FrStatus): StepDef | null {
  return FR_FLOW.find((s) => s.from === status) ?? null;
}

/** Role yang mengajukan/merevisi: PM; ADMIN boleh membantu sebagai pemohon. */
export function canSubmit(role: Role): boolean {
  return role === 'PM' || role === 'ADMIN';
}

/** Daftar aksi yang boleh dilakukan role pada status tertentu. */
export function allowedActions(status: FrStatus, role: Role): FrAction[] {
  const actions: FrAction[] = [];
  if (status === 'DRAFT' && canSubmit(role)) actions.push('SUBMIT');
  if (status === 'DITOLAK' && canSubmit(role)) actions.push('REVISE');
  const step = currentStep(status);
  if (step && status !== 'DRAFT' && step.role === role) {
    actions.push(step.step === 'PENCAIRAN' ? 'DISBURSE' : 'APPROVE');
    if (step.canReject) actions.push('REJECT');
  }
  return actions;
}

/** Status yang menunggu tindakan role tertentu (untuk inbox). */
export function inboxStatuses(role: Role): FrStatus[] {
  const statuses = FR_FLOW.filter((s) => s.from !== 'DRAFT' && s.role === role).map((s) => s.from);
  if (canSubmit(role)) statuses.push('DITOLAK');
  return statuses;
}

/** Status yang sudah tidak bisa diubah angkanya (snapshot dibekukan). */
export function isFrozen(status: FrStatus): boolean {
  return status !== 'DRAFT';
}
