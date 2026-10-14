import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CLIENT_PAYMENT_STATUS_LABEL, PO_KIND_LABEL } from '@indotek/shared';
import { api } from '../api/client';
import type { IncompletePaymentGroup, Project } from '../api/types';
import { EmptyState, ErrorBox, Money, PageHeader, Spinner } from '../components/ui';
import { formatTanggal } from '../lib/format';

/**
 * Halaman FINANCE "Pembayaran klien belum lengkap": termin yang belum ditagih padahal cluster sudah selesai /
 * implementasi lewat 30 hari, serta termin ditagih/dibayar tanpa tanggal — dikejar satu per satu.
 */
export function IncompletePaymentsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') });
  const [projectId, setProjectId] = useState('');
  const q = useQuery({
    queryKey: ['incomplete-payments', projectId],
    queryFn: () => api<IncompletePaymentGroup[]>(`/client-payments/incomplete${projectId ? `?projectId=${projectId}` : ''}`),
  });
  const total = (q.data ?? []).reduce((n, g) => n + g.count, 0);

  return (
    <div>
      <PageHeader
        title="Pembayaran klien belum lengkap"
        subtitle="Termin belum ditagih padahal cluster selesai / implementasi lewat 30 hari, dan termin ditagih/dibayar tanpa tanggal. Lengkapi dari dokumen invoice & mutasi rekening."
      />
      <div className="mb-3 flex items-center gap-3">
        <select className="input max-w-xs" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Filter project">
          <option value="">Semua project</option>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
        <span className="text-sm text-slate-600" data-testid="incomplete-count">{total} termin</span>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !q.data?.length ? (
        <EmptyState title="Semua pembayaran klien sudah lengkap." />
      ) : (
        <div className="space-y-4">
          {q.data.map((g) => (
            <section key={g.projectId} className="card overflow-x-auto" aria-label={`Project ${g.projectCode}`}>
              <div className="flex items-baseline justify-between border-b px-4 py-3">
                <h2 className="font-semibold">{g.projectCode}</h2>
                <span className="text-sm text-slate-500">{g.count} termin · DPP <Money value={g.total} /></span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr><th className="th">Cluster</th><th className="th">PO / termin</th><th className="th num">DPP</th><th className="th">Invoice</th><th className="th">Status</th><th className="th">Perlu dilengkapi</th></tr>
                </thead>
                <tbody>
                  {g.items.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="td whitespace-normal">
                        <Link className="text-brand hover:underline" to={`/clusters/${p.clusterId}?tab=termin`}>{p.clusterName}</Link>
                        <div className="text-[11px] text-slate-500">{p.clusterStatus === 'DONE' ? 'Selesai' : p.implementationDate ? `Implementasi ${formatTanggal(p.implementationDate)}` : ''}</div>
                      </td>
                      <td className="td">
                        {PO_KIND_LABEL[p.kind]}{p.poSubKind ? ` ${p.poSubKind === 'SUBFEEDER' ? 'Subfeeder' : 'Cluster'}` : ''}{p.poNumber ? ` · ${p.poNumber}` : ''} — termin {p.termin}
                      </td>
                      <td className="td num"><Money value={p.amount} plain /></td>
                      <td className="td">{p.invoiceNo ?? '—'}<div className="text-[11px] text-slate-500">{p.invoiceDate ? formatTanggal(p.invoiceDate) : ''}</div></td>
                      <td className="td">{CLIENT_PAYMENT_STATUS_LABEL[p.status]}</td>
                      <td className="td whitespace-normal text-xs text-amber-800">{p.reasons.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
