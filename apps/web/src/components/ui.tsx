import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { CLUSTER_STATUS_LABEL, FR_STATUS_LABEL, type ClusterStatus, type FrStatus } from '@indotek/shared';
import { formatAngka, formatPersen, formatRupiah, isNegative } from '../lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/** Nilai rupiah; negatif merah. `plain` = tanpa "Rp". */
export function Money({ value, plain, decimals = 0, className }: { value: string | null | undefined; plain?: boolean; decimals?: number; className?: string }) {
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  return (
    <span className={cx('tabular-nums', isNegative(value) && 'text-red-600', className)}>
      {plain ? formatAngka(value, decimals) : formatRupiah(value, decimals)}
    </span>
  );
}

export function Pct({ value, decimals = 2, className }: { value: string | null | undefined; decimals?: number; className?: string }) {
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  return <span className={cx('tabular-nums', isNegative(value) && 'text-red-600', className)}>{formatPersen(value, decimals)}</span>;
}

const FR_COLOR: Record<FrStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-300',
  DIAJUKAN: 'bg-blue-50 text-blue-700 ring-blue-200',
  DIPERIKSA_FINANCE: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  DISETUJUI_DIREKTUR: 'bg-violet-50 text-violet-700 ring-violet-200',
  DIKETAHUI_INVESTOR: 'bg-amber-50 text-amber-800 ring-amber-200',
  DICAIRKAN: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  DITOLAK: 'bg-red-50 text-red-700 ring-red-200',
};

export function StatusBadge({ status }: { status: FrStatus }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', FR_COLOR[status])}>
      {FR_STATUS_LABEL[status]}
    </span>
  );
}

const CL_COLOR: Record<ClusterStatus, string> = {
  PLAN: 'bg-slate-100 text-slate-600',
  ONGOING: 'bg-blue-50 text-blue-700',
  DONE: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-red-50 text-red-600 line-through',
};

export function ClusterStatusBadge({ status }: { status: ClusterStatus }) {
  return <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', CL_COLOR[status])}>{CLUSTER_STATUS_LABEL[status]}</span>;
}

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn-ghost p-1" onClick={onClose} aria-label="Tutup">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t bg-slate-50 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm disabled:opacity-50"
    >
      <span className={cx('relative h-5 w-9 rounded-full transition', checked ? 'bg-brand' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-4' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'neg' | 'pos' }) {
  return (
    <div className="card min-w-0 px-3 py-3 sm:px-4">
      <div className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-1 break-words text-base font-bold tabular-nums sm:text-lg', tone === 'neg' && 'text-red-600', tone === 'pos' && 'text-emerald-700')}>{value}</div>
    </div>
  );
}
