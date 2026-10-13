import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FR_STATUSES, FR_STATUS_LABEL, type FrStatus } from '@indotek/shared';
import { api, download } from '../api/client';
import type { FrListItem, Project } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { FrTable } from '../components/FrTable';
import { ErrorBox, PageHeader, Spinner, cx } from '../components/ui';

export function FundRequestListPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<FrStatus | ''>('');
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (projectId) params.set('projectId', projectId);
  if (search.trim()) params.set('q', search.trim());
  const qs = params.toString();
  const q = useQuery({ queryKey: ['fund-requests', qs], queryFn: () => api<FrListItem[]>(`/fund-requests?${qs}`) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') });

  return (
    <div>
      <PageHeader
        title="Pengajuan Dana"
        subtitle="Form pengajuan modal kerja ke investor per cluster"
        actions={
          <>
            <button className="btn-secondary" onClick={() => void download(`/export/fund-requests.xlsx?${qs}`, 'Pengajuan_Dana.xlsx')}>
              <Download className="h-4 w-4" /> Export
            </button>
            {can('PM', 'ADMIN') && (
              <Link to="/pengajuan/baru" className="btn-primary"><Plus className="h-4 w-4" /> Buat Pengajuan</Link>
            )}
          </>
        }
      />
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Filter status">
        {(['', ...FR_STATUSES] as const).map((s) => (
          <button
            key={s || 'all'}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={cx('shrink-0 rounded-full border px-3 py-1 text-xs font-medium', status === s ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}
          >
            {s ? FR_STATUS_LABEL[s] : 'Semua'}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Cari nomor / cluster…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className="input sm:w-56" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Filter project">
          <option value="">Semua project</option>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : <FrTable items={q.data ?? []} empty="Belum ada pengajuan yang cocok." />}
    </div>
  );
}
