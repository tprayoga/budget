import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, Circle, FileDown, Pencil, RotateCcw, Send, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { APPROVAL_STEP_LABEL, BUDGET_LABEL, EXPENSE_CATEGORY_LABEL, FR_FLOW, ROLE_LABEL, currentStep, todayJakartaIso, type ApprovalStep } from '@indotek/shared';
import { api, download, errorMessage } from '../api/client';
import type { FrDetail, FrUsage } from '../api/types';
import { FrSheet } from '../components/FrSheet';
import { ErrorBox, Field, Modal, Money, PageHeader, Spinner, StatusBadge, cx } from '../components/ui';
import { ExpenseStatusBadge } from '../components/realization';
import { formatTanggal, formatTanggalJam } from '../lib/format';

function Timeline({ fr }: { fr: FrDetail }) {
  const steps: ApprovalStep[] = ['DIAJUKAN', 'PERIKSA_FINANCE', 'SETUJU_DIREKTUR', 'MENGETAHUI_INVESTOR', 'PENCAIRAN'];
  const active = currentStep(fr.status);
  return (
    <div className="card p-4">
      <h2 className="mb-3 font-semibold">Alur persetujuan</h2>
      <ol className="space-y-3">
        {steps.map((s) => {
          const sig = fr.signatures[s];
          const isActive = fr.status !== 'DRAFT' && active?.step === s;
          const isRejectedHere = fr.status === 'DITOLAK' && fr.approvals.at(-1)?.step === s;
          return (
            <li key={s} className="flex gap-3">
              {sig?.at ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              ) : isRejectedHere ? (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              ) : (
                <Circle className={cx('mt-0.5 h-5 w-5 shrink-0', isActive ? 'text-amber-500' : 'text-slate-300')} />
              )}
              <div className="min-w-0 text-sm">
                <div className={cx('font-medium', isActive && 'text-amber-700')}>{APPROVAL_STEP_LABEL[s]}</div>
                {sig?.at ? (
                  <div className="text-xs text-slate-500">{sig.name} · {formatTanggalJam(sig.at)}</div>
                ) : isActive ? (
                  <div className="text-xs text-amber-700">Menunggu {ROLE_LABEL[FR_FLOW.find((f) => f.step === s)!.role]}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {fr.approvals.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">Riwayat lengkap ({fr.approvals.length})</summary>
          <ul className="mt-2 space-y-2">
            {fr.approvals.map((a) => (
              <li key={a.id} className="border-l-2 pl-2 text-xs" style={{ borderColor: a.action === 'REJECT' ? '#dc2626' : '#16a34a' }}>
                <b>{a.action === 'REJECT' ? 'Ditolak' : APPROVAL_STEP_LABEL[a.step]}</b> — {a.user.name} ({ROLE_LABEL[a.user.role]})
                <div className="text-slate-500">{formatTanggalJam(a.at)}</div>
                {a.note && <div className="italic text-slate-600">“{a.note}”</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Dana cair vs realisasi vs sisa dana di tangan (pengajuan DICAIRKAN). */
function UsagePanel({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['fr-usage', id], queryFn: () => api<FrUsage>(`/fund-requests/${id}/realization`) });
  const [loading, setLoading] = useState(false);
  if (!q.data) return null;
  const u = q.data;
  const rows = u.rows.filter((r) => Number(r.cair) !== 0 || Number(r.realisasi) !== 0);
  return (
    <section className="card overflow-x-auto" aria-label="Dana cair vs realisasi">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-semibold">Dana cair vs Realisasi vs Sisa dana di tangan</h2>
        <button
          className="btn-secondary px-2 py-1 text-xs"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              await download(`/fund-requests/${id}/realization-report.pdf`, 'Laporan_Realisasi.pdf', true);
            } finally {
              setLoading(false);
            }
          }}
        >
          <FileDown className="h-3.5 w-3.5" /> Laporan realisasi (PDF)
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="th">Pos</th><th className="th num">Dana cair</th><th className="th num">Realisasi</th><th className="th num">Sisa di tangan</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-t">
              <td className="td">{BUDGET_LABEL[r.code]}</td>
              <td className="td num"><Money value={r.cair} plain /></td>
              <td className="td num"><Money value={r.realisasi} plain /></td>
              <td className="td num font-semibold"><Money value={r.sisa} plain /></td>
            </tr>
          ))}
          <tr className="border-t bg-accent font-bold"><td className="td">TOTAL</td><td className="td num"><Money value={u.total.cair} plain /></td><td className="td num"><Money value={u.total.realisasi} plain /></td><td className="td num"><Money value={u.total.sisa} plain /></td></tr>
        </tbody>
      </table>
      <div className="border-t px-4 py-3 text-sm">
        <div className="mb-1 font-semibold">Realisasi yang ditautkan ({u.expenses.length})</div>
        {u.menungguVerifikasi > 0 && <p className="text-xs text-amber-700">{u.menungguVerifikasi} realisasi menunggu verifikasi Finance (belum dihitung).</p>}
        <ul className="space-y-1">
          {u.expenses.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">{e.date ?? '—'}</span>
              <span>{EXPENSE_CATEGORY_LABEL[e.category]}</span>
              <span className="flex-1 truncate">{e.description}</span>
              <Money value={e.clusterAmount ?? e.amount} />
              <ExpenseStatusBadge status={e.status} />
            </li>
          ))}
          {!u.expenses.length && <li className="text-xs text-slate-500">Tautkan realisasi dari menu Realisasi (ubah realisasi → pilih pengajuan) atau saat input.</li>}
        </ul>
      </div>
    </section>
  );
}

export function FundRequestDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fund-request', id], queryFn: () => api<FrDetail>(`/fund-requests/${id}`) });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [cairOpen, setCairOpen] = useState(false);
  const [note, setNote] = useState('');
  const [cairTanggal, setCairTanggal] = useState(todayJakartaIso());
  const [file, setFile] = useState<File | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const done = async (data?: FrDetail) => {
    if (data) qc.setQueryData(['fund-request', id], data);
    setRejectOpen(false);
    setApproveOpen(false);
    setCairOpen(false);
    setNote('');
    await qc.invalidateQueries({ queryKey: ['inbox'] });
    await qc.invalidateQueries({ queryKey: ['fund-requests'] });
  };
  const action = useMutation({
    mutationFn: ({ path, json }: { path: string; json?: object }) => api<FrDetail>(`/fund-requests/${id}/${path}`, { method: 'POST', json: json ?? {} }),
    onSuccess: done,
  });
  const disburse = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set('cairTanggal', cairTanggal);
      if (note) fd.set('note', note);
      if (file) fd.set('file', file);
      return api<FrDetail>(`/fund-requests/${id}/disburse`, { method: 'POST', body: fd });
    },
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api(`/fund-requests/${id}`, { method: 'DELETE' }),
    onSuccess: () => nav('/pengajuan'),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return null;
  const fr = q.data;
  const acts = fr.allowedActions;
  const step = currentStep(fr.status);

  const pdf = async () => {
    setPdfLoading(true);
    try {
      await download(`/fund-requests/${id}/pdf`, `${fr.label}.pdf`, true);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{fr.label} <StatusBadge status={fr.status} /></span>}
        subtitle={
          <>
            <Link to={`/clusters/${fr.cluster.id}`} className="text-brand hover:underline">{fr.cluster.name}</Link> · {fr.project.code} · termin ke-{fr.terminKe}
          </>
        }
        actions={
          <button className="btn-secondary" onClick={() => void pdf()} disabled={pdfLoading}>
            <FileDown className="h-4 w-4" /> {pdfLoading ? 'Membuat PDF…' : 'Unduh PDF'}
          </button>
        }
      />

      {fr.status === 'DITOLAK' && fr.rejectedNote && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <b>Ditolak:</b> {fr.rejectedNote}
        </div>
      )}
      {fr.overrideReason && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>Override sisa budget</b> oleh {fr.overrideBy?.name}: {fr.overrideReason}
        </div>
      )}
      {fr.live && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
          Draft: angka mengikuti budget & setting terkini, dan akan dibekukan saat diajukan.
        </div>
      )}
      {fr.status === 'DICAIRKAN' && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Dana dicairkan tanggal <b>{formatTanggal(fr.cairTanggal)}</b>.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {fr.status === 'DICAIRKAN' && <UsagePanel id={fr.id} />}
          <FrSheet fr={fr} />
        </div>
        <div className="order-first min-w-0 space-y-4 lg:order-none lg:sticky lg:top-6 lg:self-start">
          {acts.length > 0 && (
            <div className="card space-y-2 p-4" aria-label="Aksi">
              <h2 className="font-semibold">Tindakan Anda</h2>
              {acts.includes('SUBMIT') && (
                <>
                  <Link to={`/pengajuan/${id}/edit`} className="btn-secondary w-full"><Pencil className="h-4 w-4" /> Edit draft</Link>
                  <Link to={`/pengajuan/${id}/edit?step=4`} className="btn-primary w-full"><Send className="h-4 w-4" /> Review &amp; Ajukan</Link>
                  {!fr.number && (
                    <button className="btn-ghost w-full text-red-600" onClick={() => confirm('Hapus draft ini?') && remove.mutate()}>
                      <Trash2 className="h-4 w-4" /> Hapus draft
                    </button>
                  )}
                </>
              )}
              {acts.includes('APPROVE') && (
                <button className="btn-success w-full py-3 text-base" onClick={() => setApproveOpen(true)}>
                  <CheckCircle2 className="h-5 w-5" /> {step?.label ?? 'Setujui'}
                </button>
              )}
              {acts.includes('REJECT') && (
                <button className="btn-danger w-full py-3 text-base" onClick={() => setRejectOpen(true)}>
                  <XCircle className="h-5 w-5" /> Tolak
                </button>
              )}
              {acts.includes('DISBURSE') && (
                <button className="btn-success w-full py-3 text-base" onClick={() => setCairOpen(true)}>
                  <Banknote className="h-5 w-5" /> Tandai Dicairkan
                </button>
              )}
              {acts.includes('REVISE') && (
                <button className="btn-primary w-full" onClick={() => action.mutate({ path: 'revise' })}>
                  <RotateCcw className="h-4 w-4" /> Revisi (kembali ke draft)
                </button>
              )}
              <ErrorBox error={action.error ? errorMessage(action.error) : remove.error ? errorMessage(remove.error) : null} />
            </div>
          )}
          <Timeline fr={fr} />
        </div>
      </div>

      <Modal
        open={approveOpen}
        title={step?.label ?? 'Setujui'}
        onClose={() => setApproveOpen(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setApproveOpen(false)}>Batal</button>
            <button className="btn-success" disabled={action.isPending} onClick={() => action.mutate({ path: 'approve', json: { note: note || null } })}>
              Setujui
            </button>
          </>
        }
      >
        <p className="text-sm">Total diajukan <b>{fr.terbilang}</b>.</p>
        <Field label="Catatan (opsional)"><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox error={action.error ? errorMessage(action.error) : null} />
      </Modal>

      <Modal
        open={rejectOpen}
        title="Tolak pengajuan"
        onClose={() => setRejectOpen(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRejectOpen(false)}>Batal</button>
            <button className="btn-danger" disabled={note.trim().length < 3 || action.isPending} onClick={() => action.mutate({ path: 'reject', json: { note } })}>
              Tolak
            </button>
          </>
        }
      >
        <Field label="Alasan penolakan" hint="Wajib diisi; pemohon dapat merevisi lalu mengajukan ulang dengan nomor yang sama.">
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorBox error={action.error ? errorMessage(action.error) : null} />
      </Modal>

      <Modal
        open={cairOpen}
        title="Tandai dana dicairkan"
        onClose={() => setCairOpen(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setCairOpen(false)}>Batal</button>
            <button className="btn-success" disabled={!file || disburse.isPending} onClick={() => disburse.mutate()}>Simpan</button>
          </>
        }
      >
        <Field label="Tanggal pencairan"><input type="date" className="input" value={cairTanggal} onChange={(e) => setCairTanggal(e.target.value)} /></Field>
        <Field label="Bukti transfer" hint="PDF atau gambar, maks. 10 MB.">
          <input type="file" accept="application/pdf,image/*" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Catatan (opsional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox error={disburse.error ? errorMessage(disburse.error) : null} />
      </Modal>
    </div>
  );
}
