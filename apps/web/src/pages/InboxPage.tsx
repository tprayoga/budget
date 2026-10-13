import { Link } from 'react-router-dom';
import { CLIENT_PAYMENT_STATUS_LABEL, PO_KIND_LABEL, ROLE_LABEL } from '@indotek/shared';
import { useAuth } from '../auth/AuthContext';
import { FrTable } from '../components/FrTable';
import { useInbox, useMissingInvoiceDates } from '../components/Layout';
import { MissingDateBadge } from '../components/ClientPaymentsTab';
import { ErrorBox, Money, PageHeader, Spinner } from '../components/ui';

const HINT: Record<string, string> = {
  FINANCE: 'Pengajuan yang perlu diperiksa, dan yang sudah diketahui investor untuk dicairkan.',
  DIREKTUR: 'Pengajuan yang sudah diperiksa Finance dan menunggu persetujuan Anda.',
  INVESTOR: 'Pengajuan yang sudah disetujui Direktur dan menunggu konfirmasi Anda.',
  PM: 'Pengajuan Anda yang ditolak dan perlu direvisi.',
  ADMIN: 'Pengajuan yang ditolak dan perlu direvisi.',
};

export function InboxPage() {
  const { user, can } = useAuth();
  const q = useInbox();
  const missing = useMissingInvoiceDates(can('FINANCE'));
  return (
    <div>
      <PageHeader title="Inbox Approval" subtitle={user ? `${ROLE_LABEL[user.role]} — ${HINT[user.role]}` : undefined} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : <FrTable items={q.data?.items ?? []} empty="Tidak ada pengajuan yang menunggu tindakan Anda." />}
      {can('FINANCE') && (
        <section className="card mt-4 overflow-x-auto" aria-label="Termin tanpa tanggal invoice">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">Termin klien: tanggal invoice / diterima belum diisi <span className="ml-1 rounded-full bg-amber-100 px-2 text-xs text-amber-800" data-testid="missing-invoice-count">{missing.data?.length ?? 0}</span></h2>
            <p className="text-xs text-slate-500">Tanggal invoice tidak diisi otomatis. Lengkapi dari dokumen invoice di tab Termin Klien cluster.</p>
          </div>
          {missing.isLoading ? <Spinner /> : missing.error ? <ErrorBox error={missing.error} /> : missing.data?.length ? (
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Cluster</th><th className="th">PO / termin</th><th className="th">Invoice</th><th className="th num">Bruto</th><th className="th">Status</th></tr></thead>
              <tbody>
                {missing.data.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="td"><Link className="text-brand hover:underline" to={`/clusters/${m.clusterId}?tab=termin`}>{m.clusterName}</Link><div className="text-[11px] text-slate-500">{m.projectCode}</div></td>
                    <td className="td">{PO_KIND_LABEL[m.kind]}{m.poNumber ? ` · ${m.poNumber}` : ''} — termin {m.termin}</td>
                    <td className="td">{m.invoiceNo ?? '—'}<div><MissingDateBadge what={m.missing === 'PAID' ? 'paid' : 'invoice'} /></div></td>
                    <td className="td num"><Money value={m.amount} plain /></td>
                    <td className="td">{CLIENT_PAYMENT_STATUS_LABEL[m.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Semua termin sudah lengkap.</p>
          )}
        </section>
      )}
    </div>
  );
}
