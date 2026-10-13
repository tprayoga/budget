import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ALLOCATION_METHOD_LABEL,
  ALLOCATION_METHODS,
  BUDGET_LABEL,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_STATUS_LABEL,
  FR_CODES,
  todayJakartaIso,
  type AllocationMethod,
  type ExpenseCategory,
  type ExpenseStatus,
  type FrCode,
} from '@indotek/shared';
import { api, download, errorMessage } from '../api/client';
import type { ClusterRealization, Expense } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { compressImage } from '../lib/image';
import { formatAngka, formatPersen, formatTanggal, rpInputToValue } from '../lib/format';
import { ErrorBox, Field, Modal, Money, Spinner, cx } from './ui';

export const EXPENSE_STATUS_COLOR: Record<ExpenseStatus, string> = {
  PERLU_VERIFIKASI: 'bg-amber-50 text-amber-800 ring-amber-200',
  TERVERIFIKASI: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  DITOLAK: 'bg-red-50 text-red-700 ring-red-200',
};

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', EXPENSE_STATUS_COLOR[status])}>{EXPENSE_STATUS_LABEL[status]}</span>;
}

const LEVEL_ROW: Record<'ok' | 'warn' | 'over', string> = { ok: '', warn: 'bg-amber-50', over: 'bg-red-50' };
const LEVEL_TEXT: Record<'ok' | 'warn' | 'over', string> = { ok: 'text-slate-700', warn: 'text-amber-700 font-semibold', over: 'text-red-700 font-bold' };

export function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['expenses', 'realization', 'cluster', 'rekap', 'client-payments', 'expense-pending', 'fund-request', 'fr-usage', 'missing-invoice-dates', 'notifications']) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
}

// ------------------------------------------------------------------ tab Realisasi

export function ClusterRealizationTab({ clusterId, projectId }: { clusterId: string; projectId: string }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['realization', clusterId], queryFn: () => api<ClusterRealization>(`/clusters/${clusterId}/realization`) });
  const [open, setOpen] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  const p = r.profit;
  const rows = r.rows.filter((x) => Number(x.budget) !== 0 || Number(x.realisasi) !== 0 || Number(x.menungguVerifikasi) !== 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-3"><div className="text-xs text-slate-500">Pembayaran klien (bruto)</div><div className="text-lg font-bold"><Money value={p.pembayaranBruto} /></div><div className="text-[11px] text-slate-500">Kas diterima <Money value={p.kasDiterima} /></div></div>
        <div className="card p-3"><div className="text-xs text-slate-500">Realisasi biaya</div><div className="text-lg font-bold"><Money value={p.realisasiBiaya} /></div><div className="text-[11px] text-slate-500">dari budget <Money value={r.total.budget} /></div></div>
        <div className="card p-3"><div className="text-xs text-slate-500">Profit realisasi</div><div className="text-lg font-bold"><Money value={p.profitRealisasi} /></div><div className="text-[11px] text-slate-500">proyeksi <Money value={p.proyeksiProfit} /></div></div>
        <div className="card p-3"><div className="text-xs text-slate-500">Menunggu verifikasi</div><div className="text-lg font-bold text-amber-700"><Money value={r.total.menungguVerifikasi} /></div><div className="text-[11px] text-slate-500">belum dihitung</div></div>
      </div>
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Budget vs realisasi per pos</h2>
          <span className="text-xs text-slate-500">kuning &gt; {formatPersen(r.warnPct, 0)}, merah &gt; 100%</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Pos</th><th className="th num">Budget</th><th className="th num">Realisasi</th><th className="th num">Sisa</th><th className="th num">% terpakai</th><th className="th num hidden md:table-cell">Menunggu</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.code} className={cx('border-t', LEVEL_ROW[x.level])} data-level={x.level}>
                <td className="td">{BUDGET_LABEL[x.code]}</td>
                <td className="td num"><Money value={x.budget} plain /></td>
                <td className="td num font-semibold"><Money value={x.realisasi} plain /></td>
                <td className="td num"><Money value={x.sisa} plain /></td>
                <td className={cx('td num', LEVEL_TEXT[x.level])}>{formatPersen(x.pctTerpakai, 1)}</td>
                <td className="td num hidden text-amber-700 md:table-cell"><Money value={x.menungguVerifikasi} plain /></td>
              </tr>
            ))}
            <tr className={cx('border-t font-bold', LEVEL_ROW[r.total.level])}>
              <td className="td">TOTAL</td><td className="td num"><Money value={r.total.budget} plain /></td><td className="td num"><Money value={r.total.realisasi} plain /></td>
              <td className="td num"><Money value={r.total.sisa} plain /></td><td className={cx('td num', LEVEL_TEXT[r.total.level])}>{formatPersen(r.total.pctTerpakai, 1)}</td><td className="td hidden md:table-cell" />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Daftar realisasi</h2>
        {can('ADMIN', 'PM', 'FINANCE') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Realisasi</button>}
      </div>
      <ExpenseList query={`clusterId=${clusterId}`} clusterId={clusterId} />
      <ExpenseFormModal open={open} onClose={() => setOpen(false)} defaultProjectId={projectId} defaultClusterId={clusterId} />
    </div>
  );
}

// ------------------------------------------------------------------ daftar expense

export function ExpenseList({ query, clusterId, showProject }: { query: string; clusterId?: string; showProject?: boolean }) {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['expenses', query], queryFn: () => api<Expense[]>(`/expenses?${query}`) });
  const [rejecting, setRejecting] = useState<Expense | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [note, setNote] = useState('');
  const act = useMutation({
    mutationFn: ({ id, path, json, method = 'POST' }: { id: string; path: string; json?: object; method?: string }) => api(`/expenses/${id}${path}`, { method, json }),
    onSuccess: () => {
      setRejecting(null);
      setNote('');
      invalidateAll(qc);
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rows = q.data ?? [];
  if (!rows.length) return <p className="card px-4 py-8 text-center text-sm text-slate-500">Belum ada realisasi.</p>;
  const canEdit = (e: Expense) => !e.locked && (can('ADMIN', 'FINANCE') || (user?.id === e.createdBy?.id && e.status !== 'TERVERIFIKASI'));
  return (
    <div className="card overflow-x-auto">
      <ErrorBox error={act.error ? errorMessage(act.error) : null} />
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr><th className="th">Tanggal</th>{showProject && <th className="th">Project</th>}<th className="th">Kategori / Pos</th><th className="th">Keterangan</th><th className="th num">Nominal</th><th className="th">Status</th><th className="th" /></tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-t align-top">
              <td className="td">{e.date ? formatTanggal(e.date) : <span className="text-slate-400">{e.periodLabel ?? '—'}</span>}</td>
              {showProject && <td className="td">{e.project.code}</td>}
              <td className="td"><div>{EXPENSE_CATEGORY_LABEL[e.category]}</div><div className="text-[11px] text-slate-500">{BUDGET_LABEL[e.budgetCode]}</div></td>
              <td className="td max-w-[320px] whitespace-normal">
                <div>{e.description}</div>
                <div className="text-[11px] text-slate-500">
                  {e.cluster ? e.cluster.name : `Level project · ${e.allocationMethod ? ALLOCATION_METHOD_LABEL[e.allocationMethod] : ''} · ${e.allocations.length} cluster`}
                  {e.source !== 'MANUAL' && ` · via ${e.source === 'WEBHOOK' ? `bot ${e.apiKey?.name ?? ''}` : e.source === 'IMPORT_RAB' ? 'import RAB' : e.source === 'CLIENT_PAYMENT' ? 'potongan pembayaran klien' : 'HP'}`}
                  {e.fundRequest && ` · ${e.fundRequest.number ?? 'pengajuan'}`}
                </div>
                {e.rejectNote && <div className="text-[11px] text-red-600">Ditolak: {e.rejectNote}</div>}
                {e.note && <div className="text-[11px] font-medium text-amber-700">Catatan: {e.note}</div>}
              </td>
              <td className="td num">
                <Money value={clusterId && e.clusterAmount ? e.clusterAmount : e.amount} />
                {clusterId && e.clusterAmount && e.clusterAmount !== e.amount && <div className="text-[11px] text-slate-500">dari <Money value={e.amount} /></div>}
              </td>
              <td className="td"><ExpenseStatusBadge status={e.status} /></td>
              <td className="td">
                <div className="flex justify-end gap-1">
                  {e.hasAttachment && (
                    <button className="btn-ghost p-1" title="Lihat nota" aria-label="Lihat nota" onClick={() => void download(`/expenses/${e.id}/attachment`, e.attachmentName ?? 'nota', true)}>
                      <Paperclip className="h-4 w-4" />
                    </button>
                  )}
                  {can('FINANCE') && e.status === 'PERLU_VERIFIKASI' && (
                    <>
                      <button className="btn-success px-2 py-1 text-xs" onClick={() => act.mutate({ id: e.id, path: '/verify' })} aria-label={`Verifikasi ${e.description}`}><Check className="h-3.5 w-3.5" /> Verifikasi</button>
                      <button className="btn-ghost p-1 text-red-600" title="Tolak" aria-label={`Tolak ${e.description}`} onClick={() => setRejecting(e)}><X className="h-4 w-4" /></button>
                    </>
                  )}
                  {canEdit(e) && <button className="btn-ghost p-1" aria-label="Ubah" onClick={() => setEditing(e)}><Pencil className="h-4 w-4" /></button>}
                  {canEdit(e) && <button className="btn-ghost p-1 text-red-600" aria-label="Hapus" onClick={() => confirm('Hapus realisasi ini?') && act.mutate({ id: e.id, path: '', method: 'DELETE' })}><Trash2 className="h-4 w-4" /></button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal
        open={!!rejecting}
        title="Tolak realisasi"
        onClose={() => setRejecting(null)}
        footer={<><button className="btn-secondary" onClick={() => setRejecting(null)}>Batal</button><button className="btn-danger" disabled={note.trim().length < 3} onClick={() => rejecting && act.mutate({ id: rejecting.id, path: '/reject', json: { note } })}>Tolak</button></>}
      >
        <Field label="Alasan"><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
      {editing && <ExpenseFormModal open onClose={() => setEditing(null)} existing={editing} defaultProjectId={editing.project.id} />}
    </div>
  );
}

// ------------------------------------------------------------------ form expense

interface ClusterOpt { id: string; name: string; projectId: string; status: string; nilaiPoImpl: string; project: { code: string } }

export function ExpenseFormModal({
  open,
  onClose,
  defaultProjectId,
  defaultClusterId,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
  defaultClusterId?: string;
  existing?: Expense;
}) {
  const qc = useQueryClient();
  const clusters = useQuery({ queryKey: ['clusters', 'all'], queryFn: () => api<ClusterOpt[]>('/clusters'), enabled: open });
  const mappings = useQuery({ queryKey: ['category-mappings'], queryFn: () => api<{ category: ExpenseCategory; budgetCode: FrCode | null }[]>('/category-mappings'), enabled: open });
  const [projectId, setProjectId] = useState(existing?.project.id ?? defaultProjectId ?? '');
  const [level, setLevel] = useState<'CLUSTER' | 'PROJECT'>(existing && !existing.cluster ? 'PROJECT' : 'CLUSTER');
  const [clusterId, setClusterId] = useState(existing?.cluster?.id ?? defaultClusterId ?? '');
  const [selected, setSelected] = useState<string[]>(existing?.allocations.map((a) => a.clusterId) ?? []);
  const [method, setMethod] = useState<AllocationMethod>(existing?.allocationMethod ?? 'EQUAL');
  const [manual, setManual] = useState<Record<string, string>>(Object.fromEntries((existing?.allocations ?? []).map((a) => [a.clusterId, formatAngka(a.amount, 2).replace(/,00$/, '')])));
  const [date, setDate] = useState(existing?.date ?? todayJakartaIso());
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'OPS');
  const [budgetCode, setBudgetCode] = useState<FrCode | ''>(existing?.budgetCode ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [amount, setAmount] = useState(existing ? formatAngka(existing.amount, 2).replace(/,00$/, '') : '');
  const [vendor, setVendor] = useState(existing?.vendor ?? '');
  const [invoiceNo, setInvoiceNo] = useState(existing?.invoiceNo ?? '');
  const [file, setFile] = useState<File | null>(null);

  const projectClusters = useMemo(() => (clusters.data ?? []).filter((c) => c.projectId === projectId && c.status !== 'CANCELLED'), [clusters.data, projectId]);
  const projects = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clusters.data ?? []) m.set(c.projectId, c.project.code);
    return [...m.entries()];
  }, [clusters.data]);
  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0][0]);
  }, [projects, projectId]);
  const defaultCode = mappings.data?.find((m) => m.category === category)?.budgetCode ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const amt = rpInputToValue(amount);
      if (!amt) throw new Error('Nominal tidak valid');
      const body: Record<string, unknown> = {
        projectId,
        clusterId: level === 'CLUSTER' ? clusterId : null,
        clusterIds: level === 'PROJECT' ? selected : undefined,
        allocationMethod: level === 'PROJECT' ? method : null,
        manualAllocations: level === 'PROJECT' && method === 'MANUAL' ? selected.map((id) => ({ clusterId: id, amount: rpInputToValue(manual[id] ?? '0') ?? '0' })) : undefined,
        date,
        category,
        budgetCode: budgetCode || null,
        description,
        amount: amt,
        vendor: vendor || null,
        invoiceNo: invoiceNo || null,
      };
      let id = existing?.id;
      if (existing) {
        await api(`/expenses/${existing.id}`, { method: 'PATCH', json: body });
      } else if (file) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(body)) {
          if (v === undefined || v === null) continue;
          fd.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        }
        fd.set('file', await compressImage(file));
        id = (await api<Expense>('/expenses', { method: 'POST', body: fd })).id;
      } else {
        id = (await api<Expense>('/expenses', { method: 'POST', json: body })).id;
      }
      if (existing && file && id) {
        const fd = new FormData();
        fd.set('file', await compressImage(file));
        await api(`/expenses/${id}/attachment`, { method: 'POST', body: fd });
      }
    },
    onSuccess: () => {
      invalidateAll(qc);
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      title={existing ? 'Ubah realisasi' : 'Tambah realisasi'}
      onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Batal</button><button className="btn-primary" disabled={save.isPending || !description.trim() || !amount} onClick={() => save.mutate()}>{save.isPending ? 'Menyimpan…' : 'Simpan'}</button></>}
    >
      <ErrorBox error={save.error ? errorMessage(save.error) : null} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Project">
          <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setClusterId(''); setSelected([]); }} disabled={!!existing}>
            {projects.map(([id, code]) => <option key={id} value={id}>{code}</option>)}
          </select>
        </Field>
        <Field label="Tingkat">
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value as 'CLUSTER' | 'PROJECT')}>
            <option value="CLUSTER">Satu cluster</option>
            <option value="PROJECT">Level project (dialokasikan)</option>
          </select>
        </Field>
      </div>
      {level === 'CLUSTER' ? (
        <Field label="Cluster">
          <select className="input" value={clusterId} onChange={(e) => setClusterId(e.target.value)} aria-label="Cluster">
            <option value="">Pilih…</option>
            {projectClusters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      ) : (
        <div className="space-y-2 rounded-lg border p-3">
          <Field label="Metode alokasi">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value as AllocationMethod)}>
              {ALLOCATION_METHODS.map((m) => <option key={m} value={m}>{ALLOCATION_METHOD_LABEL[m]}</option>)}
            </select>
          </Field>
          <div className="text-xs text-slate-500">Cluster tujuan (kosong = semua cluster aktif; sisa pembulatan ke cluster terakhir)</div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {projectClusters.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                <span className="flex-1 truncate">{c.name}</span>
                {method === 'MANUAL' && selected.includes(c.id) && (
                  <input className="input w-32 py-1 text-right" inputMode="decimal" value={manual[c.id] ?? ''} onChange={(e) => setManual({ ...manual, [c.id]: e.target.value })} aria-label={`Alokasi ${c.name}`} />
                )}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kategori">
          <select className="input" value={category} onChange={(e) => { setCategory(e.target.value as ExpenseCategory); setBudgetCode(''); }}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Pos budget" hint={defaultCode ? `Default: ${BUDGET_LABEL[defaultCode]}` : 'Wajib dipilih'}>
          <select className="input" value={budgetCode} onChange={(e) => setBudgetCode(e.target.value as FrCode | '')}>
            <option value="">{defaultCode ? `Default (${BUDGET_LABEL[defaultCode]})` : 'Pilih…'}</option>
            {FR_CODES.map((c) => <option key={c} value={c}>{BUDGET_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Tanggal"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Nominal (Rp)"><input className="input text-right" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Nominal" /></Field>
      </div>
      <Field label="Keterangan"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Keterangan" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor"><input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
        <Field label="No. invoice / nota"><input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
      </div>
      <Field label="Foto nota / dokumen" hint="Foto dikompres otomatis sebelum diunggah.">
        <input type="file" accept="image/*,application/pdf" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
    </Modal>
  );
}
