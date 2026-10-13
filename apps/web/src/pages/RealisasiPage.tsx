import { useQuery } from '@tanstack/react-query';
import { Plus, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, EXPENSE_STATUSES, EXPENSE_STATUS_LABEL, type ExpenseStatus } from '@indotek/shared';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ExpenseFormModal, ExpenseList } from '../components/realization';
import { PageHeader, cx } from '../components/ui';

export function RealisasiPage() {
  const { can } = useAuth();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') });
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<ExpenseStatus | ''>(can('FINANCE') ? 'PERLU_VERIFIKASI' : '');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  if (q.trim()) params.set('q', q.trim());

  return (
    <div>
      <PageHeader
        title="Realisasi Biaya"
        subtitle="Hanya realisasi terverifikasi Finance yang dihitung ke budget vs realisasi."
        actions={
          can('ADMIN', 'PM', 'FINANCE') && (
            <>
              <Link to="/realisasi/cepat" className="btn-secondary"><Smartphone className="h-4 w-4" /> Input cepat</Link>
              <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Realisasi</button>
            </>
          )
        }
      />
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter status realisasi">
        {(['', ...EXPENSE_STATUSES] as const).map((s) => (
          <button key={s || 'all'} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={cx('shrink-0 rounded-full border px-3 py-1 text-xs font-medium', status === s ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-600')}>
            {s ? EXPENSE_STATUS_LABEL[s] : 'Semua'}
          </button>
        ))}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <input className="input" placeholder="Cari keterangan / vendor…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Filter project">
          <option value="">Semua project</option>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter kategori">
          <option value="">Semua kategori</option>
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</option>)}
        </select>
      </div>
      <ExpenseList query={params.toString()} showProject />
      {open && <ExpenseFormModal open onClose={() => setOpen(false)} defaultProjectId={projectId || undefined} />}
    </div>
  );
}
