import { ROLE_LABEL } from '@indotek/shared';
import { useAuth } from '../auth/AuthContext';
import { FrTable } from '../components/FrTable';
import { useInbox } from '../components/Layout';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';

const HINT: Record<string, string> = {
  FINANCE: 'Pengajuan yang perlu diperiksa, dan yang sudah diketahui investor untuk dicairkan.',
  DIREKTUR: 'Pengajuan yang sudah diperiksa Finance dan menunggu persetujuan Anda.',
  INVESTOR: 'Pengajuan yang sudah disetujui Direktur dan menunggu konfirmasi Anda.',
  PM: 'Pengajuan Anda yang ditolak dan perlu direvisi.',
  ADMIN: 'Pengajuan yang ditolak dan perlu direvisi.',
};

export function InboxPage() {
  const { user } = useAuth();
  const q = useInbox();
  return (
    <div>
      <PageHeader title="Inbox Approval" subtitle={user ? `${ROLE_LABEL[user.role]} — ${HINT[user.role]}` : undefined} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : <FrTable items={q.data?.items ?? []} empty="Tidak ada pengajuan yang menunggu tindakan Anda." />}
    </div>
  );
}
