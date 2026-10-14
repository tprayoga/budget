import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Link2, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { CLIENT_PAYMENT_STATUS_LABEL, PO_KIND_LABEL, paymentDeduction, terminTax, todayJakartaIso, type PoKind } from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import type { ClientInvoiceRef, ClientPayment, ClientPaymentsResponse, ClusterPo } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatAngka, formatPersen, formatTanggal, pctInputToRatio, ratioToPctInput, rpInputToValue } from '../lib/format';
import { invalidateAll } from './realization';
import { ErrorBox, Field, Modal, Money, Spinner, cx } from './ui';

const toInput = (v: string) => formatAngka(v, 2).replace(/,00$/, '');

/** Badge termin yang sudah ditagih / manual tetapi tanggal invoice kosong (tidak pernah diisi otomatis). */
export function MissingDateBadge({ what = 'invoice' }: { what?: 'invoice' | 'paid' }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" data-testid={what === 'invoice' ? 'badge-tanggal-invoice' : 'badge-tanggal-diterima'}>
      <AlertTriangle className="h-3 w-3" /> {what === 'invoice' ? 'tanggal invoice belum diisi' : 'tanggal diterima belum diisi'}
    </span>
  );
}

function poTitle(po: ClusterPo | undefined, kind: PoKind) {
  const sub = po?.subKind ? ` ${po.subKind === 'SUBFEEDER' ? 'Subfeeder' : 'Cluster'}` : '';
  return `PO ${PO_KIND_LABEL[po?.kind ?? kind]}${sub}${po?.poNumber ? ` · ${po.poNumber}` : ''}`;
}

type Recalc = {
  kinds: {
    poId: string;
    poNumber: string | null;
    kind: PoKind;
    base: string;
    adjustment: string;
    target: string;
    lockedSum: string;
    error: string | null;
    warning: string | null;
    diffs: { id: string | null; termin: number; status: string; oldAmount: string | null; newAmount: string; changed: boolean; deleted?: boolean }[];
  }[];
};

/**
 * Tab Termin Klien: termin dikelompokkan per PO, badge "tanggal invoice belum diisi", dan referensi tagihan dari
 * file RAB di samping termin sistem. Referensi hanya diterapkan lewat tombol "Terapkan ke termin…" (konfirmasi FINANCE).
 */
export function ClientPaymentsTab({ clusterId }: { clusterId: string }) {
  const { can } = useAuth();
  const editable = can('ADMIN', 'FINANCE');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['client-payments', clusterId], queryFn: () => api<ClientPaymentsResponse>(`/clusters/${clusterId}/client-payments`) });
  const [edit, setEdit] = useState<ClientPayment | null>(null);
  const [form, setForm] = useState({ amount: '', ppn: '', pph: '', invoiceNo: '', invoiceDate: '', dueDate: '', paidDate: '', paidAmount: '' });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDate, setBulkDate] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState({ poId: '', termin: '1', amount: '', keterangan: '' });
  const [applyRef, setApplyRef] = useState<ClientInvoiceRef | null>(null);
  const [applyForm, setApplyForm] = useState({ paymentId: '', amount: '', paidDate: '' });

  const save = useMutation({
    mutationFn: () =>
      api(`/client-payments/${edit!.id}`, {
        method: 'PATCH',
        json: {
          amount: rpInputToValue(form.amount) ?? undefined,
          ppnRate: pctInputToRatio(form.ppn) ?? undefined,
          pphRate: pctInputToRatio(form.pph) ?? undefined,
          invoiceNo: form.invoiceNo || null,
          invoiceDate: form.invoiceDate || null,
          dueDate: form.dueDate || null,
          paidDate: form.paidDate || null,
          paidAmount: form.paidAmount ? rpInputToValue(form.paidAmount) : null,
        },
      }),
    onSuccess: () => {
      setEdit(null);
      invalidateAll(qc);
    },
  });
  const create = useMutation({
    mutationFn: () =>
      api(`/clusters/${clusterId}/client-payments`, {
        method: 'POST',
        json: { poId: add.poId, kind: q.data!.pos.find((p) => p.id === add.poId)?.kind ?? 'IMPLEMENTASI', termin: Number(add.termin), amount: rpInputToValue(add.amount) ?? '0', keterangan: add.keterangan || null },
      }),
    onSuccess: () => {
      setAddOpen(false);
      invalidateAll(qc);
    },
  });
  const apply = useMutation({
    mutationFn: () =>
      api(`/client-payments/${applyForm.paymentId}/apply-reference`, {
        method: 'POST',
        json: { refId: applyRef!.id, amount: rpInputToValue(applyForm.amount), paidDate: applyForm.paidDate || null },
      }),
    onSuccess: () => {
      setApplyRef(null);
      invalidateAll(qc);
    },
  });
  const applyMatched = useMutation({
    mutationFn: (refIds?: string[]) =>
      api<{ applied: unknown[] }>(`/clusters/${clusterId}/client-payments/apply-matched`, { method: 'POST', json: { refIds, paidDate: bulkDate || null } }),
    onSuccess: () => {
      setBulkOpen(false);
      invalidateAll(qc);
    },
  });
  const [recalc, setRecalc] = useState<Recalc | null>(null);
  const preview = useMutation({ mutationFn: () => api<Recalc>(`/clusters/${clusterId}/client-payments/recalculate`), onSuccess: setRecalc });
  const applyRecalc = useMutation({
    mutationFn: () => api(`/clusters/${clusterId}/client-payments/recalculate`, { method: 'POST' }),
    onSuccess: () => {
      setRecalc(null);
      invalidateAll(qc);
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { payments, templates, pos, invoiceRefs, missingInvoiceDate, totals } = q.data!;
  const matched = invoiceRefs.filter((r) => !r.appliedPaymentId && r.suggestion?.clusterId === clusterId && r.suggestion.mode === 'NET');
  const today = todayJakartaIso();
  const aging = (kind: string) => templates.find((t) => t.kind === kind);
  const groups = [
    ...pos.map((po) => ({ key: po.id, po, kind: po.kind, rows: payments.filter((p) => p.poId === po.id) })),
    ...(payments.some((p) => !p.poId) ? [{ key: 'none', po: undefined, kind: 'IMPLEMENTASI' as PoKind, rows: payments.filter((p) => !p.poId) }] : []),
  ].filter((g) => g.rows.length || g.po);
  const termLabel = (p: ClientPayment) => `${poTitle(pos.find((x) => x.id === p.poId), p.kind)} — termin ${p.termin}`;
  const applyTarget = payments.find((p) => p.id === applyForm.paymentId);
  const applyNet = applyRef?.netAmount ?? null;
  const applyBruto = rpInputToValue(applyForm.amount);
  const applyTax = applyTarget && applyBruto ? terminTax({ amount: applyBruto, ppnRate: applyTarget.ppnRate, pphRate: applyTarget.pphRate }) : null;
  const termLabelById = (id: string) => {
    const p = payments.find((x) => x.id === id);
    return p ? termLabel(p) : 'termin cluster lain';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>
          {templates.length
            ? templates.map((t) => `${PO_KIND_LABEL[t.kind]}: ${t.lines} termin${t.agingDays != null ? `, jatuh tempo ${t.agingDays} hari ${t.agingType === 'WORKING' ? 'kerja' : 'kalender'}` : ''}`).join(' · ')
            : 'Client ini belum punya template termin — input manual.'}
          {' · '}PO Addwork/Deduction/SND: 1 termin 100%.
        </span>
        {editable && (
          <div className="flex gap-2">
            <button className="btn-secondary px-2 py-1 text-xs" disabled={preview.isPending} onClick={() => preview.mutate()}>
              <RefreshCw className="h-3.5 w-3.5" /> Hitung ulang termin
            </button>
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => { setAdd({ poId: pos[0]?.id ?? '', termin: '1', amount: '', keterangan: '' }); setAddOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Termin manual
            </button>
          </div>
        )}
      </div>
      {missingInvoiceDate > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
          <AlertTriangle className="h-4 w-4" /> {missingInvoiceDate} termin: tanggal invoice belum diisi. Tanggal tidak diisi otomatis — lengkapi dari dokumen invoice.
        </div>
      )}
      <ErrorBox error={preview.error ? errorMessage(preview.error) : applyMatched.error && !bulkOpen ? errorMessage(applyMatched.error) : null} />

      {groups.map((g) => (
        <div key={g.key} className="card overflow-x-auto" data-testid={`po-group-${g.kind}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-slate-50 px-3 py-2 text-sm">
            <span className="font-semibold">{poTitle(g.po, g.kind)}</span>
            {g.po && <span className="text-xs text-slate-500">Nilai PO <Money value={g.po.amount} /></span>}
          </div>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Termin</th><th className="th num">DPP</th><th className="th num" title="PPN keluaran — titipan, bukan pendapatan/biaya">PPN (titipan)</th><th className="th num" title="DPP + PPN − PPh">Net diharapkan</th><th className="th">Invoice</th><th className="th">Jatuh tempo</th><th className="th num">Diterima</th><th className="th num">Potongan (PAJAK)</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>
              {g.rows.map((p) => {
                const overdue = p.status === 'INVOICED' && p.dueDate && p.dueDate < today;
                return (
                  <tr key={p.id} className={cx('border-t', overdue && 'bg-red-50')}>
                    <td className="td whitespace-normal">
                      <b>Termin {p.termin}</b>{p.pct && <span className="text-slate-500"> · {formatPersen(p.pct, 0)}</span>}
                      <div className="text-[11px] text-slate-500">{p.keterangan}</div>
                    </td>
                    <td className="td num"><Money value={p.amount} plain /></td>
                    <td className="td num text-slate-500"><Money value={p.ppnAmount} plain /><div className="text-[11px]">{formatPersen(p.ppnRate, 0)}</div></td>
                    <td className="td num"><Money value={p.expectedNet} plain /><div className="text-[11px] text-slate-500">PPh {formatPersen(p.pphRate)}</div></td>
                    <td className="td">
                      {p.invoiceNo ?? '—'}
                      <div className="text-[11px] text-slate-500">{p.invoiceDate ? formatTanggal(p.invoiceDate) : p.needsInvoiceDate ? <MissingDateBadge /> : null}</div>
                    </td>
                    <td className={cx('td', overdue && 'font-semibold text-red-700')}>{p.dueDate ? formatTanggal(p.dueDate) : '—'}{overdue && <div className="text-[11px]">Terlambat</div>}</td>
                    <td className="td num">{p.paidAmount ? <Money value={p.paidAmount} plain /> : '—'}<div className="text-[11px] text-slate-500">{p.paidDate ? formatTanggal(p.paidDate) : p.needsPaidDate ? <MissingDateBadge what="paid" /> : null}</div></td>
                    <td className="td num">{Number(p.potongan) ? <Money value={p.potongan} plain /> : '—'}</td>
                    <td className="td"><span className={cx('rounded px-1.5 py-0.5 text-xs', p.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' : p.status === 'INVOICED' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600')}>{CLIENT_PAYMENT_STATUS_LABEL[p.status]}</span></td>
                    <td className="td">
                      {editable && (
                        <button
                          className="btn-ghost p-1"
                          aria-label={`Ubah termin ${p.kind} ${p.termin}`}
                          onClick={() => {
                            setEdit(p);
                            setForm({ amount: toInput(p.amount), ppn: ratioToPctInput(p.ppnRate), pph: ratioToPctInput(p.pphRate), invoiceNo: p.invoiceNo ?? '', invoiceDate: p.invoiceDate ?? '', dueDate: p.dueDate ?? '', paidDate: p.paidDate ?? '', paidAmount: p.paidAmount ? toInput(p.paidAmount) : '' });
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!g.rows.length && (
                <tr><td colSpan={10} className="td text-center text-slate-500">{g.kind === 'ADDWORK' || g.kind === 'DEDUCTION' ? 'Mengoreksi termin 1 PO implementasi (lihat "Hitung ulang termin").' : 'Belum ada termin untuk PO ini.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
      {!groups.length && <p className="card p-4 text-center text-sm text-slate-500">Belum ada PO / termin.</p>}
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm" data-testid="termin-totals">
        <span>Total DPP <Money value={totals.dpp} /></span>
        <span>PPN keluaran (tagihan) <Money value={totals.ppn} /></span>
        <span className="font-semibold">PPN keluaran (titipan, termin dibayar) <Money value={totals.ppnTitipan} /></span>
      </div>
      <p className="text-xs text-slate-500">
        DPP = pendapatan. PPN keluaran adalah titipan (bukan pendapatan maupun biaya). Bila diterima &lt; DPP + PPN, selisihnya (PPh dan potongan lain)
        otomatis dicatat sebagai realisasi PAJAK. Profit realisasi = DPP termin dibayar − realisasi biaya.
      </p>

      <section className="card overflow-x-auto" aria-label="Referensi tagihan RAB">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold">Referensi tagihan dari file RAB</h3>
            <p className="text-xs text-slate-500">Nilai RAB = net (DPP + PPN − PPh). Usulan "cocok" bila net = net diharapkan termin (± Rp 10); tetap harus dikonfirmasi.</p>
          </div>
          {editable && matched.length > 0 && (
            <button className="btn-primary px-2 py-1 text-xs" onClick={() => setBulkOpen(true)}>Terapkan semua yang cocok ({matched.length})</button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Invoice</th><th className="th">Blok RAB</th><th className="th num">Net</th><th className="th">Jatuh tempo</th><th className="th">Status RAB</th><th className="th">Usulan</th><th className="th" /></tr></thead>
          <tbody>
            {invoiceRefs.map((r) => {
              const applied = payments.find((p) => p.id === r.appliedPaymentId);
              return (
                <tr key={r.id} className="border-t">
                  <td className="td">{r.termin ? `Term ${r.termin} · ` : ''}<b>{r.invoiceNo}</b></td>
                  <td className="td whitespace-normal text-xs text-slate-600">{r.blockTitle ?? '—'}{!r.clusterId && <div className="text-[11px] text-amber-700">tingkat project (cluster tidak terpetakan)</div>}</td>
                  <td className="td num">{r.netAmount ? <Money value={r.netAmount} plain /> : '—'}</td>
                  <td className="td">{r.dueDate ? formatTanggal(r.dueDate) : '—'}</td>
                  <td className="td"><span className={cx('rounded px-1.5 py-0.5 text-xs', r.paid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>{r.statusText ?? '—'}</span></td>
                  <td className="td whitespace-normal text-xs" data-testid="ref-suggestion">
                    {r.appliedPaymentId ? null : r.suggestion?.mode === 'DPP' ? (
                      <span className="text-amber-700" data-testid="cocok-dpp">
                        <b>cocok di DPP</b> → {r.suggestion.clusterId === clusterId ? termLabelById(r.suggestion.paymentId) : `${r.suggestion.clusterName} termin ${r.suggestion.termin}`}
                        <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold">perlu konfirmasi pajak</span>
                      </span>
                    ) : r.suggestion ? (
                      <span className="text-emerald-700">
                        <b>cocok</b> → {r.suggestion.clusterId === clusterId ? termLabelById(r.suggestion.paymentId) : `${r.suggestion.clusterName} termin ${r.suggestion.termin}`}
                        {r.suggestion.selisih !== '0.00' && <span className="text-slate-500"> (selisih {formatAngka(r.suggestion.selisih, 2)})</span>}
                      </span>
                    ) : r.ambiguous ? (
                      <span className="text-amber-700">lebih dari satu termin cocok — pilih manual</span>
                    ) : (
                      <span className="text-slate-400">tidak cocok — manual</span>
                    )}
                  </td>
                  <td className="td whitespace-nowrap text-right">
                    {editable && !r.appliedPaymentId && r.suggestion?.clusterId === clusterId && r.suggestion.mode === 'NET' && (
                      <button className="btn-primary mr-1 px-2 py-1 text-xs" disabled={applyMatched.isPending} onClick={() => applyMatched.mutate([r.id])}>
                        Konfirmasi
                      </button>
                    )}
                    {r.appliedPaymentId ? (
                      <span className="text-xs text-emerald-700">Diterapkan{applied ? ` ke ${termLabel(applied)}` : ''}</span>
                    ) : (
                      editable && (
                        <button
                          className="btn-secondary px-2 py-1 text-xs"
                          onClick={() => {
                            const target = payments.find((p) => p.termin === r.termin && p.status !== 'PAID') ?? payments.find((p) => p.status !== 'PAID');
                            setApplyRef(r);
                            const sug = r.suggestion?.clusterId === clusterId ? payments.find((p) => p.id === r.suggestion!.paymentId) : undefined;
                            const t = sug ?? target;
                            setApplyForm({ paymentId: t?.id ?? '', amount: t ? toInput(t.amount) : '', paidDate: r.paid ? (r.dueDate ?? '') : '' });
                          }}
                        >
                          <Link2 className="h-3.5 w-3.5" /> Terapkan ke termin…
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {!invoiceRefs.length && <tr><td colSpan={7} className="td text-center text-slate-500">Belum ada referensi tagihan (import file RAB untuk mengisi).</td></tr>}
          </tbody>
        </table>
      </section>

      <Modal
        open={!!applyRef}
        title={applyRef ? `Terapkan referensi ${applyRef.invoiceNo}` : ''}
        onClose={() => setApplyRef(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setApplyRef(null)}>Batal</button>
            <button className="btn-primary" disabled={apply.isPending || !applyForm.paymentId || !applyBruto} onClick={() => apply.mutate()}>
              {apply.isPending ? 'Menerapkan…' : 'Terapkan'}
            </button>
          </>
        }
      >
        <ErrorBox error={apply.error ? errorMessage(apply.error) : null} />
        <Field label="Termin tujuan">
          <select className="input" value={applyForm.paymentId} onChange={(e) => setApplyForm({ ...applyForm, paymentId: e.target.value, amount: toInput(payments.find((p) => p.id === e.target.value)?.amount ?? '0') })}>
            <option value="">— pilih termin —</option>
            {payments.filter((p) => p.status !== 'PAID').map((p) => <option key={p.id} value={p.id}>{termLabel(p)} (DPP {formatAngka(p.amount)}, net {formatAngka(p.expectedNet)})</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="DPP (Rp)" hint="Diisi FINANCE dari invoice (tanpa PPN)">
            <input className="input text-right" inputMode="decimal" value={applyForm.amount} onChange={(e) => setApplyForm({ ...applyForm, amount: e.target.value })} aria-label="DPP" />
          </Field>
          {applyRef?.paid && (
            <Field label="Tanggal diterima" hint="Kosong → ditandai perlu dilengkapi">
              <input type="date" className="input" value={applyForm.paidDate} onChange={(e) => setApplyForm({ ...applyForm, paidDate: e.target.value })} />
            </Field>
          )}
        </div>
        {applyRef && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <dt className="text-slate-500">No. invoice</dt><dd className="text-right">{applyRef.invoiceNo}</dd>
            {applyTax && (
              <>
                <dt className="text-slate-500">PPN keluaran (titipan)</dt><dd className="text-right"><Money value={applyTax.ppn.toString()} /></dd>
                <dt className="text-slate-500">Tagihan (DPP + PPN)</dt><dd className="text-right"><Money value={applyTax.invoiceTotal.toString()} /></dd>
                <dt className="text-slate-500">Net diharapkan</dt><dd className="text-right"><Money value={applyTax.expectedNet.toString()} /></dd>
              </>
            )}
            <dt className="text-slate-500">Diterima (net referensi)</dt><dd className="text-right">{applyRef.paid && applyNet ? <Money value={applyNet} /> : '— (belum dibayar → status Ditagih)'}</dd>
            {applyRef.paid && applyNet && applyTax && (
              <>
                <dt className="text-slate-500">Potongan → realisasi PAJAK</dt>
                <dd className="text-right"><Money value={paymentDeduction(applyTax.invoiceTotal, applyNet).toString()} /></dd>
              </>
            )}
            <dt className="text-slate-500">Tanggal invoice</dt><dd className="text-right text-amber-700">tidak diisi (tidak ada di RAB)</dd>
          </dl>
        )}
        {applyTarget && applyRef?.termin && applyTarget.termin !== applyRef.termin && (
          <p className="text-xs text-amber-700">Perhatian: referensi bertanda termin {applyRef.termin}, termin tujuan ke-{applyTarget.termin}.</p>
        )}
      </Modal>

      <Modal
        open={!!edit}
        title={edit ? termLabel(edit) : ''}
        onClose={() => setEdit(null)}
        footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Simpan</button></>}
      >
        <ErrorBox error={save.error ? errorMessage(save.error) : null} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="DPP (Rp)"><input className="input text-right" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-label="DPP termin" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="PPN (%)"><input className="input text-right" inputMode="decimal" value={form.ppn} onChange={(e) => setForm({ ...form, ppn: e.target.value })} aria-label="PPN persen" /></Field>
            <Field label="PPh (%)"><input className="input text-right" inputMode="decimal" value={form.pph} onChange={(e) => setForm({ ...form, pph: e.target.value })} aria-label="PPh persen" /></Field>
          </div>
          <Field label="No. invoice"><input className="input" value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} /></Field>
          <Field label="Tanggal invoice"><input type="date" className="input" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} aria-label="Tanggal invoice" /></Field>
          <Field label="Jatuh tempo" hint={edit && aging(edit.kind)?.agingDays != null ? 'Dihitung otomatis dari template' : 'Isi manual'}>
            <input type="date" className="input" value={form.dueDate} disabled={!!(edit && aging(edit.kind)?.agingDays != null)} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
          <Field label="Tanggal dibayar"><input type="date" className="input" value={form.paidDate} onChange={(e) => setForm({ ...form, paidDate: e.target.value })} aria-label="Tanggal dibayar" /></Field>
          <Field label="Nominal diterima (Rp)"><input className="input text-right" inputMode="decimal" value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} aria-label="Nominal diterima" /></Field>
        </div>
        {(() => {
          const t = terminTax({ amount: rpInputToValue(form.amount) ?? '0', ppnRate: pctInputToRatio(form.ppn) ?? '0', pphRate: pctInputToRatio(form.pph) ?? '0' });
          const pot = paymentDeduction(t.invoiceTotal, rpInputToValue(form.paidAmount));
          return (
            <div className="space-y-1 text-xs">
              <p className="text-slate-500">PPN <Money value={t.ppn.toString()} /> · tagihan <Money value={t.invoiceTotal.toString()} /> · net diharapkan <Money value={t.expectedNet.toString()} /></p>
              {pot.gt(0) && <p className="text-amber-700">Potongan <Money value={pot.toString()} /> akan dicatat sebagai realisasi PAJAK.</p>}
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={!!recalc}
        title="Hitung ulang termin (nilai PO terkini)"
        onClose={() => setRecalc(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRecalc(null)}>Batal</button>
            <button
              className="btn-primary"
              disabled={applyRecalc.isPending || !recalc || recalc.kinds.some((k) => k.error) || !recalc.kinds.some((k) => k.diffs.some((d) => d.changed))}
              onClick={() => applyRecalc.mutate()}
            >
              Terapkan
            </button>
          </>
        }
      >
        <p className="text-xs text-slate-500">Termin yang sudah ditagih/dibayar tidak berubah. Selisih masuk ke termin belum ditagih yang terakhir.</p>
        <ErrorBox error={applyRecalc.error ? errorMessage(applyRecalc.error) : null} />
        {recalc?.kinds.map((k) => (
          <div key={k.poId} className="space-y-1" data-testid={`recalc-${k.kind}`}>
            <div className="text-sm font-semibold">
              PO {PO_KIND_LABEL[k.kind]}{k.poNumber ? ` · ${k.poNumber}` : ''} — target <Money value={k.target} /> <span className="font-normal text-slate-500">(nilai PO <Money value={k.base} />)</span>
            </div>
            {Number(k.adjustment) !== 0 && <p className="text-xs text-slate-600">Koreksi addwork/deduction ke termin 1: <Money value={k.adjustment} /></p>}
            {k.warning && <p className="text-xs font-medium text-amber-700" role="alert">{k.warning}</p>}
            {k.error && <p className="text-xs text-red-600">{k.error}</p>}
            <table className="w-full text-xs">
              <thead><tr><th className="th">Termin</th><th className="th">Status</th><th className="th num">Sebelum</th><th className="th num">Sesudah</th></tr></thead>
              <tbody>
                {k.diffs.map((d) => (
                  <tr key={`${d.termin}-${d.id}`} className={cx('border-t', d.deleted ? 'bg-red-50 text-red-700' : d.changed && 'bg-accent-50 font-semibold')}>
                    <td className="td">{d.termin}</td>
                    <td className="td">{d.deleted ? 'Dihapus' : d.status === 'BARU' ? 'Baru' : CLIENT_PAYMENT_STATUS_LABEL[d.status as keyof typeof CLIENT_PAYMENT_STATUS_LABEL]}</td>
                    <td className="td num">{d.oldAmount ? <Money value={d.oldAmount} plain /> : '—'}</td>
                    <td className="td num">{d.deleted ? '—' : <Money value={d.newAmount} plain />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {recalc && !recalc.kinds.some((k) => k.diffs.some((d) => d.changed)) && <p className="text-sm text-emerald-700">Tidak ada perubahan — termin sudah sesuai nilai PO.</p>}
      </Modal>

      <Modal
        open={addOpen}
        title="Tambah termin manual"
        onClose={() => setAddOpen(false)}
        footer={<><button className="btn-secondary" onClick={() => setAddOpen(false)}>Batal</button><button className="btn-primary" disabled={create.isPending || !add.amount || !add.poId} onClick={() => create.mutate()}>Simpan</button></>}
      >
        <ErrorBox error={create.error ? errorMessage(create.error) : null} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="PO">
            <select className="input" value={add.poId} onChange={(e) => setAdd({ ...add, poId: e.target.value })}>
              {pos.map((p) => <option key={p.id} value={p.id}>{poTitle(p, p.kind)}</option>)}
            </select>
          </Field>
          <Field label="Termin ke-"><input className="input" inputMode="numeric" value={add.termin} onChange={(e) => setAdd({ ...add, termin: e.target.value })} /></Field>
          <Field label="Bruto (Rp)"><input className="input text-right" value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value })} /></Field>
        </div>
        <Field label="Keterangan"><input className="input" value={add.keterangan} onChange={(e) => setAdd({ ...add, keterangan: e.target.value })} /></Field>
      </Modal>
      <Modal
        open={bulkOpen}
        title={`Terapkan ${matched.length} referensi yang cocok`}
        onClose={() => setBulkOpen(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setBulkOpen(false)}>Batal</button>
            <button className="btn-primary" disabled={applyMatched.isPending} onClick={() => applyMatched.mutate(matched.map((r) => r.id))}>
              {applyMatched.isPending ? 'Menerapkan…' : 'Konfirmasi semua'}
            </button>
          </>
        }
      >
        <ErrorBox error={applyMatched.error ? errorMessage(applyMatched.error) : null} />
        <ul className="divide-y rounded-lg border text-sm">
          {matched.map((r) => (
            <li key={r.id} className="flex justify-between gap-2 px-3 py-1.5">
              <span><b>{r.invoiceNo}</b> → {termLabelById(r.suggestion!.paymentId)}</span>
              <span><Money value={r.netAmount} /> {r.paid ? '· Dibayar' : '· Ditagih'}</span>
            </li>
          ))}
        </ul>
        <Field label="Tanggal diterima (opsional)" hint="Untuk referensi Paid tanpa jatuh tempo. Kosong → status Dibayar dengan tanda 'tanggal diterima belum diisi'.">
          <input type="date" className="input" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} aria-label="Tanggal diterima semua" />
        </Field>
      </Modal>
    </div>
  );
}
