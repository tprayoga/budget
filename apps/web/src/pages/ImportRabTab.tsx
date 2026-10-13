import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileSpreadsheet, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  ALLOCATION_METHOD_LABEL,
  ALLOCATION_METHODS,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  sum,
  type AllocationMethod,
  type ExpenseCategory,
  type RabDecision,
} from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import { ErrorBox, Money, cx } from '../components/ui';
import { formatTanggal } from '../lib/format';

type Target =
  | { scope: 'CLUSTER'; clusterId: string; clusterName: string }
  | { scope: 'PROJECT'; clusterIds: string[]; clusterNames: string[]; method: AllocationMethod }
  | { scope: 'SKIP' };
type Status = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'NEEDS_MAPPING' | 'SKIPPED';
interface Item {
  key: string;
  sheet: string;
  cell: string;
  section: string;
  blockTitle: string | null;
  groupTitle: string | null;
  label: string;
  date: string | null;
  periodText: string | null;
  amount: string;
  category: ExpenseCategory | null;
  suggestedCategory: ExpenseCategory | null;
  warnings: string[];
  projectCode: string;
  projectId: string | null;
  mappingKey: string;
  target: Target | null;
  targetSource: 'AUTO' | 'RULE' | null;
  suggestedTarget: Target | null;
  status: Status;
  diffs: { field: string; oldValue: string | null; newValue: string | null }[];
}
interface Preview {
  sheets: { sheetName: string; projectCode: string; error: string | null; totals: { cell: string; label: string; blockTitle: string | null; value: string }[]; invoices: { key: string; blockTitle: string | null; termin: number | null; invoiceNo: string; amount: string | null; dueDate: string | null; statusText: string | null }[] }[];
  items: Item[];
  summary: Record<Status, number>;
  created?: number;
  updated?: number;
}

const STATUS_STYLE: Record<Status, string> = {
  NEW: 'bg-emerald-50 text-emerald-700',
  CHANGED: 'bg-amber-50 text-amber-800',
  UNCHANGED: 'bg-slate-100 text-slate-500',
  NEEDS_MAPPING: 'bg-red-50 text-red-700',
  SKIPPED: 'bg-slate-100 text-slate-400',
};
const STATUS_LABEL: Record<Status, string> = { NEW: 'Baru', CHANGED: 'Berubah', UNCHANGED: 'Sama', NEEDS_MAPPING: 'Perlu dipetakan', SKIPPED: 'Dilewati' };

const targetText = (t: Target | null) =>
  !t ? '—' : t.scope === 'SKIP' ? 'Dilewati' : t.scope === 'CLUSTER' ? t.clusterName : `Project (${ALLOCATION_METHOD_LABEL[t.method]}): ${t.clusterNames.length} cluster`;

/** Form keputusan target untuk satu grup/blok. */
function TargetEditor({ value, onChange, clusters }: { value: RabDecision | undefined; onChange: (d: RabDecision) => void; clusters: { id: string; name: string }[] }) {
  const d: RabDecision = value ?? { scope: 'PROJECT', clusterIds: [], method: 'EQUAL' };
  return (
    <div className="space-y-2">
      <select className="input" value={d.scope === 'INHERIT' ? 'PROJECT' : d.scope} onChange={(e) => onChange({ ...d, scope: e.target.value as RabDecision['scope'] })} aria-label="Tujuan">
        <option value="CLUSTER">Satu cluster</option>
        <option value="PROJECT">Level project (dialokasikan)</option>
        <option value="SKIP">Lewati (tidak diimpor)</option>
      </select>
      {d.scope === 'CLUSTER' && (
        <select className="input" value={d.clusterId ?? ''} onChange={(e) => onChange({ ...d, clusterId: e.target.value })} aria-label="Cluster tujuan">
          <option value="">Pilih cluster…</option>
          {clusters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {d.scope === 'PROJECT' && (
        <>
          <select className="input" value={d.method ?? 'EQUAL'} onChange={(e) => onChange({ ...d, method: e.target.value as AllocationMethod })} aria-label="Metode alokasi">
            {ALLOCATION_METHODS.filter((m) => m !== 'MANUAL').map((m) => <option key={m} value={m}>{ALLOCATION_METHOD_LABEL[m]}</option>)}
          </select>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-2 text-xs">
            {clusters.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" checked={(d.clusterIds ?? []).includes(c.id)} onChange={(e) => onChange({ ...d, clusterIds: e.target.checked ? [...(d.clusterIds ?? []), c.id] : (d.clusterIds ?? []).filter((x) => x !== c.id) })} />
                {c.name}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">Tidak dicentang = semua cluster aktif project.</p>
        </>
      )}
    </div>
  );
}

export function ImportRabTab() {
  const qc = useQueryClient();
  const clusters = useQuery({ queryKey: ['clusters', 'all'], queryFn: () => api<{ id: string; name: string; projectId: string; status: string }[]>('/clusters') });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, RabDecision>>({});
  const [filter, setFilter] = useState<Status | ''>('');
  const [result, setResult] = useState<string | null>(null);

  const send = (mode: 'dry-run' | 'commit') => {
    const fd = new FormData();
    fd.set('file', file!);
    if (mode === 'commit') fd.set('decisions', JSON.stringify(decisions));
    return api<Preview>(`/import/rab-xlsx?mode=${mode}`, { method: 'POST', body: fd });
  };
  const dry = useMutation({ mutationFn: () => send('dry-run'), onSuccess: (p) => { setPreview(p); setResult(null); setDecisions({}); } });
  const commit = useMutation({
    mutationFn: () => send('commit'),
    onSuccess: async (p) => {
      setResult(`Import selesai: ${p.created} realisasi baru, ${p.updated} diperbarui.`);
      setPreview(p);
      setDecisions({});
      await qc.invalidateQueries();
    },
  });

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of preview?.items ?? []) if (i.status === 'NEEDS_MAPPING') m.set(i.mappingKey, [...(m.get(i.mappingKey) ?? []), i]);
    return [...m.entries()];
  }, [preview]);
  const rows = (preview?.items ?? []).filter((i) => (filter ? i.status === filter : i.status !== 'UNCHANGED'));
  const projectClusters = (projectId: string | null) => (clusters.data ?? []).filter((c) => c.projectId === projectId && c.status !== 'CANCELLED');
  const decide = (key: string, d: Partial<RabDecision>) => setDecisions((all) => ({ ...all, [key]: { ...(all[key] ?? { scope: 'INHERIT' }), ...d } as RabDecision }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        File RAB Project TELCO - IBK: blok subcon (Total Jasa / Material / Permit), Biaya OPS, Biaya PJD, dan daftar lain di sheet ADW, EVANTAMA, CCSI.
        Item yang tidak bisa dipetakan otomatis tidak ditebak — tentukan tujuannya di bawah. Keputusan diingat untuk import berikutnya.
      </p>
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 hover:bg-slate-50">
          <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
          <span className="text-sm">{file ? file.name : 'Pilih file RAB .xlsx…'}</span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} aria-label="File RAB" />
        </label>
        <button className="btn-primary" disabled={!file || dry.isPending} onClick={() => dry.mutate()}><Upload className="h-4 w-4" /> {dry.isPending ? 'Membaca…' : 'Preview (dry-run)'}</button>
      </div>
      <ErrorBox error={dry.error ? errorMessage(dry.error) : commit.error ? errorMessage(commit.error) : null} />
      {result && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{result}</div>}

      {preview && (
        <>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <button key={s} onClick={() => setFilter(filter === s ? '' : s)} className={cx('rounded px-2 py-1 text-xs', STATUS_STYLE[s], filter === s && 'ring-2 ring-brand')}>
                {STATUS_LABEL[s]}: {preview.summary[s]}
              </button>
            ))}
          </div>

          {groups.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold">Perlu dipetakan manual ({groups.length} grup)</h2>
              {groups.map(([key, items]) => {
                const first = items[0];
                const needTarget = items.some((i) => !i.target);
                const cl = projectClusters(first.projectId);
                return (
                  <div key={key} className="card grid gap-3 p-4 md:grid-cols-[1fr_320px]" data-testid="rab-group">
                    <div className="min-w-0">
                      <div className="font-medium">{first.sheet} · {first.section} · {first.groupTitle ?? first.blockTitle ?? '(tanpa judul)'}</div>
                      <div className="text-xs text-slate-500">{items.length} item · <Money value={sum(items.map((i) => i.amount)).toString()} /></div>
                      <ul className="mt-2 space-y-1 text-xs">
                        {items.map((i) => (
                          <li key={i.key} className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-slate-400">{i.cell}</span>
                            <span className="min-w-0 flex-1 truncate">{i.label}</span>
                            <Money value={i.amount} plain />
                            {!i.category && (
                              <select className="input w-44 py-0.5 text-xs" value={decisions[`RAB:${i.key}`]?.category ?? ''} onChange={(e) => decide(`RAB:${i.key}`, { scope: 'INHERIT', category: (e.target.value || null) as ExpenseCategory | null })} aria-label={`Kategori ${i.cell}`}>
                                <option value="">{i.suggestedCategory ? `Usulan: ${EXPENSE_CATEGORY_LABEL[i.suggestedCategory]}` : 'Pilih kategori…'}</option>
                                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</option>)}
                              </select>
                            )}
                            {i.warnings.length > 0 && <span title={i.warnings.join('\n')}><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /></span>}
                          </li>
                        ))}
                      </ul>
                      {items.some((i) => !i.category && i.suggestedCategory) && (
                        <button
                          className="mt-2 text-xs text-brand underline"
                          onClick={() => items.forEach((i) => !i.category && i.suggestedCategory && decide(`RAB:${i.key}`, { scope: 'INHERIT', category: i.suggestedCategory }))}
                        >
                          Pakai usulan kategori
                        </button>
                      )}
                    </div>
                    {needTarget ? (
                      <div>
                        <TargetEditor value={decisions[key]} onChange={(d) => setDecisions({ ...decisions, [key]: d })} clusters={cl} />
                        {first.suggestedTarget && first.suggestedTarget.scope === 'PROJECT' && !decisions[key] && (
                          <button
                            className="mt-2 text-xs text-brand underline"
                            onClick={() => setDecisions({ ...decisions, [key]: { scope: 'PROJECT', clusterIds: (first.suggestedTarget as { clusterIds: string[] }).clusterIds, method: 'EQUAL' } })}
                          >
                            Pakai usulan: rata ke {(first.suggestedTarget as { clusterNames: string[] }).clusterNames.join(', ')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">Tujuan: {targetText(first.target)} — pilih kategori item di kiri.</div>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          <div className="flex justify-end">
            <button className="btn-primary" disabled={commit.isPending} onClick={() => commit.mutate()}>
              {commit.isPending ? 'Menyimpan…' : `Commit (${preview.summary.NEW + preview.summary.CHANGED} siap + ${Object.keys(decisions).length} keputusan)`}
            </button>
          </div>

          <section className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Sel</th><th className="th">Item</th><th className="th">Kategori</th><th className="th">Tujuan</th><th className="th num">Nominal</th><th className="th">Status</th></tr></thead>
              <tbody>
                {rows.slice(0, 400).map((i) => (
                  <tr key={i.key} className="border-t align-top">
                    <td className="td font-mono text-xs text-slate-500">{i.sheet}!{i.cell}</td>
                    <td className="td max-w-[360px] whitespace-normal">
                      {i.label}
                      <div className="text-[11px] text-slate-500">{i.blockTitle ?? i.groupTitle} · {i.date ? formatTanggal(i.date) : (i.periodText ?? 'tanpa tanggal')}</div>
                      {i.warnings.map((w) => <div key={w} className="text-[11px] text-amber-700">⚠ {w}</div>)}
                      {i.diffs.map((d) => <div key={d.field} className="text-[11px] text-slate-500">{d.field}: <s>{d.oldValue}</s> → {d.newValue}</div>)}
                    </td>
                    <td className="td">{i.category ? EXPENSE_CATEGORY_LABEL[i.category] : '—'}</td>
                    <td className="td text-xs">{targetText(i.target)}{i.targetSource === 'RULE' && <span className="ml-1 text-slate-400">(keputusan tersimpan)</span>}</td>
                    <td className="td num"><Money value={i.amount} plain /></td>
                    <td className="td"><span className={cx('rounded px-1.5 py-0.5 text-xs', STATUS_STYLE[i.status])}>{STATUS_LABEL[i.status]}</span></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="td text-center text-slate-500">Tidak ada item dengan status ini.</td></tr>}
              </tbody>
            </table>
          </section>

          <details className="card p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Total di sheet & tagihan klien (referensi)</summary>
            {preview.sheets.map((s) => (
              <div key={s.sheetName} className="mt-3">
                <div className="font-medium">{s.sheetName} {s.error && <span className="text-red-600">— {s.error}</span>}</div>
                <ul className="text-xs text-slate-600">
                  {s.totals.filter((t) => Number(t.value) !== 0).map((t) => <li key={t.cell}>{t.cell} {t.label} [{t.blockTitle}]: <Money value={t.value} /></li>)}
                </ul>
                {s.invoices.length > 0 && (
                  <ul className="mt-1 text-xs text-slate-600">
                    {s.invoices.map((v) => <li key={v.key}>Invoice {v.invoiceNo} {v.termin ? `termin ${v.termin}` : ''} [{v.blockTitle}] {v.amount && <Money value={v.amount} />} {v.statusText} — input di tab Termin Klien cluster</li>)}
                  </ul>
                )}
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}

export function ImportLedgerTab() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  type LedgerPreview = { sheet: string; summary: { total: number; new: number; existing: number }; projectLabels?: Record<string, { rows: number; matched: boolean }>; created?: number };
  const [preview, setPreview] = useState<LedgerPreview | null>(null);
  const send = (mode: 'dry-run' | 'commit') => {
    const fd = new FormData();
    fd.set('file', file!);
    return api<LedgerPreview>(`/import/cash-ledger-xlsx?mode=${mode}`, { method: 'POST', body: fd });
  };
  const dry = useMutation({ mutationFn: () => send('dry-run'), onSuccess: setPreview });
  const commit = useMutation({ mutationFn: () => send('commit'), onSuccess: async (p) => { setPreview((x) => ({ ...x!, ...p })); await qc.invalidateQueries(); } });
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Buku kas dari sheet berheader Date / Description / Project / Cash In / Cash Out (mis. "TELCO - OPS"). Nilai hasil IMPORTRANGE dibaca dari cache. Buku kas hanya referensi (rekonsiliasi), tidak dihitung sebagai realisasi.</p>
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 hover:bg-slate-50">
          <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
          <span className="text-sm">{file ? file.name : 'Pilih file .xlsx…'}</span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} aria-label="File buku kas" />
        </label>
        <button className="btn-primary" disabled={!file || dry.isPending} onClick={() => dry.mutate()}><Upload className="h-4 w-4" /> Preview</button>
      </div>
      <ErrorBox error={dry.error ? errorMessage(dry.error) : commit.error ? errorMessage(commit.error) : null} />
      {preview && (
        <div className="card space-y-3 p-4 text-sm">
          <div>Sheet <b>{preview.sheet}</b>: {preview.summary.total} baris · <b>{preview.summary.new}</b> baru · {preview.summary.existing} sudah ada{preview.created !== undefined && <span className="ml-2 text-emerald-700">— {preview.created} baris diimpor</span>}</div>
          {preview.projectLabels && (
            <ul className="grid gap-1 text-xs sm:grid-cols-3">
              {Object.entries(preview.projectLabels).map(([label, v]) => (
                <li key={label} className={cx('rounded px-2 py-1', v.matched ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600')}>{label}: {v.rows} baris {v.matched ? '→ project' : '(tidak ada project, disimpan dengan label)'}</li>
              ))}
            </ul>
          )}
          <button className="btn-primary" disabled={!preview.summary.new || commit.isPending} onClick={() => commit.mutate()}>Import {preview.summary.new} baris baru</button>
        </div>
      )}
    </div>
  );
}
