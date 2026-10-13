import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileSpreadsheet, Upload } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Money, PageHeader, cx } from '../components/ui';
import { HeldItemsPanel, ImportLedgerTab, ImportRabTab } from './ImportRabTab';
import { formatPersen } from '../lib/format';

type Status = 'NEW' | 'CHANGED' | 'PROTECTED' | 'UNCHANGED' | 'MISSING_IN_FILE';
type Diff = { field: string; oldValue: string | null; newValue: string | null; protected?: boolean; protectedReason?: string | null; overriddenAt?: string | null; overriddenBy?: string | null };
interface Preview {
  mode: string;
  sheets: { sheetName: string; projectCode: string; projectName: string | null; error: string | null; clusterCount: number; warnings: string[]; summary: Record<Status, number> }[];
  clusters: { key: string; projectCode: string; name: string; column: string | null; status: Status; diffs: Diff[]; nilaiProyek: string; profit: string }[];
  assumptions: { interestRate: string | null; retensiAsCost: boolean | null };
  created?: number;
  updated?: number;
  skippedProtected?: number;
}

const STATUS_STYLE: Record<Status, string> = {
  NEW: 'bg-emerald-50 text-emerald-700',
  CHANGED: 'bg-amber-50 text-amber-800',
  PROTECTED: 'bg-violet-50 text-violet-700',
  UNCHANGED: 'bg-slate-100 text-slate-500',
  MISSING_IN_FILE: 'bg-red-50 text-red-600',
};
const STATUS_LABEL: Record<Status, string> = { NEW: 'Baru', CHANGED: 'Berubah', PROTECTED: 'Dilindungi', UNCHANGED: 'Sama', MISSING_IN_FILE: 'Tidak ada di file' };

export function BudgetImportTab() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const isAdmin = can('ADMIN');
  /** Penimpaan field dilindungi (khusus ADMIN): clusterKey → field[]. */
  const [force, setForce] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState('');
  const forcedCount = Object.values(force).reduce((n, f) => n + f.length, 0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [result, setResult] = useState<string | null>(null);

  const send = (mode: 'dry-run' | 'commit') => {
    const fd = new FormData();
    fd.set('file', file!);
    if (mode === 'commit') {
      fd.set('keys', JSON.stringify([...selected]));
      if (forcedCount) {
        fd.set('force', JSON.stringify(force));
        fd.set('reason', reason);
      }
    }
    return api<Preview>(`/import/budget-xlsx?mode=${mode}`, { method: 'POST', body: fd });
  };
  const dry = useMutation({
    mutationFn: () => send('dry-run'),
    onSuccess: (p) => {
      setPreview(p);
      setResult(null);
      setForce({});
      setReason('');
      setSelected(new Set(p.clusters.filter((c) => c.status === 'NEW' || c.status === 'CHANGED').map((c) => c.key)));
    },
  });
  const commit = useMutation({
    mutationFn: () => send('commit'),
    onSuccess: async (p) => {
      setResult(`Import selesai: ${p.created} cluster baru, ${p.updated} cluster diperbarui${p.skippedProtected ? `, ${p.skippedProtected} field dilindungi dilewati` : ''}.`);
      setPreview(p);
      setSelected(new Set());
      setForce({});
      setReason('');
      await qc.invalidateQueries();
    },
  });

  const rows = useMemo(() => (preview?.clusters ?? []).filter((c) => !onlyChanges || c.status !== 'UNCHANGED'), [preview, onlyChanges]);
  const toggleForce = (key: string, field: string) => {
    const cur = force[key] ?? [];
    const next = cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field];
    setForce({ ...force, [key]: next });
    if (next.length) setSelected((s) => new Set(s).add(key));
  };
  const toggle = (set: Set<string>, key: string) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  };

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">Layout seperti file Budget_Per_Cluster (sheet per project: ADW, EVANTAMA, CCSI). Dry-run dulu, lalu commit.</p>
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 hover:bg-slate-50">
          <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
          <span className="text-sm">{file ? file.name : 'Pilih file .xlsx…'}</span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
        </label>
        <button className="btn-primary" disabled={!file || dry.isPending} onClick={() => dry.mutate()}>
          <Upload className="h-4 w-4" /> {dry.isPending ? 'Membaca…' : 'Preview (dry-run)'}
        </button>
      </div>
      <div className="mt-3"><ErrorBox error={dry.error ? errorMessage(dry.error) : commit.error ? errorMessage(commit.error) : null} /></div>
      {result && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{result}</div>}

      {preview && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {preview.sheets.map((s) => (
              <div key={s.sheetName} className="card p-3 text-sm">
                <div className="font-semibold">Sheet {s.sheetName} → {s.projectName ?? s.projectCode}</div>
                {s.error ? <p className="text-red-600">{s.error}</p> : (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(Object.keys(s.summary) as Status[]).filter((k) => s.summary[k]).map((k) => (
                      <span key={k} className={cx('rounded px-1.5 text-xs', STATUS_STYLE[k])}>{STATUS_LABEL[k]}: {s.summary[k]}</span>
                    ))}
                  </div>
                )}
                {s.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
              </div>
            ))}
          </div>
          {preview.assumptions.interestRate && (
            <p className="text-xs text-slate-500">
              Asumsi di file: interest {formatPersen(preview.assumptions.interestRate, 0)} · retensi sebagai biaya {preview.assumptions.retensiAsCost ? 'Ya' : 'Tidak'} (tidak diimpor — atur di Rekap).
            </p>
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Hanya tampilkan perubahan
            </label>
            <button className="btn-primary" disabled={!selected.size || commit.isPending || (forcedCount > 0 && !reason.trim())} onClick={() => commit.mutate()}>
              {commit.isPending ? 'Menyimpan…' : `Commit ${selected.size} cluster`}
            </button>
          </div>
          {preview.clusters.some((c) => c.status === 'PROTECTED' || c.diffs.some((d) => d.protected)) && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-800">
              Field yang diedit di aplikasi <b>dilindungi</b> dan tidak ditimpa oleh import.
              {isAdmin ? ' Admin dapat menimpa per field (centang "Timpa") dengan alasan.' : ' Hanya Admin yang dapat menimpanya.'}
              {forcedCount > 0 && (
                <label className="mt-2 block">
                  <span className="label">Alasan penimpaan ({forcedCount} field) — wajib</span>
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Alasan penimpaan" />
                </label>
              )}
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th w-8" /><th className="th">Cluster</th><th className="th">Status</th><th className="th num">Nilai proyek</th><th className="th num">Profit</th></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const selectable = c.status === 'NEW' || c.status === 'CHANGED' || (c.status === 'PROTECTED' && (force[c.key]?.length ?? 0) > 0);
                  return (
                    <Fragment key={c.key}>
                      <tr className="border-t">
                        <td className="td">
                          {selectable && <input type="checkbox" checked={selected.has(c.key)} onChange={() => setSelected((s) => toggle(s, c.key))} aria-label={`Pilih ${c.name}`} />}
                        </td>
                        <td className="td whitespace-normal">
                          {c.diffs.length > 0 ? (
                            <button className="inline-flex items-center gap-1 text-left" onClick={() => setOpen((s) => toggle(s, c.key))}>
                              {open.has(c.key) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              {c.name}
                            </button>
                          ) : c.name}
                          <span className="ml-1 text-xs text-slate-400">{c.projectCode}{c.column ? ` · kolom ${c.column}` : ''}</span>
                        </td>
                        <td className="td"><span className={cx('rounded px-1.5 py-0.5 text-xs', STATUS_STYLE[c.status])}>{STATUS_LABEL[c.status]}</span></td>
                        <td className="td num"><Money value={c.nilaiProyek} plain /></td>
                        <td className="td num"><Money value={c.profit} plain /></td>
                      </tr>
                      {open.has(c.key) && (
                        <tr className="bg-slate-50">
                          <td />
                          <td colSpan={4} className="px-3 py-2">
                            <table className="text-xs">
                              <tbody>
                                {c.diffs.map((d) => (
                                  <tr key={d.field} className={cx(d.protected && 'text-slate-500')}>
                                    <td className="pr-4 font-mono">{d.field}</td>
                                    <td className={cx('pr-2', d.protected ? '' : 'text-red-600 line-through')}>{d.oldValue ?? '∅'}</td>
                                    <td className={cx('pr-3', d.protected ? '' : 'text-emerald-700')}>→ {d.newValue ?? '∅'}</td>
                                    <td>
                                      {d.protected && (
                                        <span className="inline-flex items-center gap-2">
                                          <span className="rounded bg-violet-100 px-1.5 text-violet-700" title={d.overriddenBy ? `oleh ${d.overriddenBy}` : undefined}>{d.protectedReason ?? 'dilindungi'}</span>
                                          {isAdmin && d.protectedReason === 'dilindungi — diedit di aplikasi' && (
                                            <label className="inline-flex items-center gap-1">
                                              <input type="checkbox" checked={force[c.key]?.includes(d.field) ?? false} onChange={() => toggleForce(c.key, d.field)} aria-label={`Timpa ${d.field} ${c.name}`} /> Timpa
                                            </label>
                                          )}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!rows.length && <tr><td colSpan={5} className="td text-center text-slate-500">Tidak ada perubahan — data sudah sama dengan file.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface PoAdjPreview {
  items: { key: string; cell: string; blockTitle: string | null; kind: 'ADDWORK' | 'DEDUCTION'; amount: string; source: string; totalFormula: string | null; clusterName: string | null; projectCode: string; status: 'NEW' | 'CHANGED' | 'UNCHANGED' | 'NO_CLUSTER'; oldAmount: string | null }[];
  clusters: { clusterId: string; clusterName: string; nilaiPoImplNow: string; nilaiPoImplAfter: string }[];
  summary: Record<'NEW' | 'CHANGED' | 'UNCHANGED' | 'NO_CLUSTER', number>;
  created?: number;
  updated?: number;
}

/** Import penyesuaian PO (baris "Deduction Termin 1 + Addwork" di file RAB) → PO Addwork/Deduction per cluster. */
export function PoAdjustmentsTab() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PoAdjPreview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const send = (mode: 'dry-run' | 'commit') => {
    const fd = new FormData();
    fd.set('file', file!);
    return api<PoAdjPreview>(`/import/po-adjustments-xlsx?mode=${mode}`, { method: 'POST', body: fd });
  };
  const dry = useMutation({ mutationFn: () => send('dry-run'), onSuccess: (p) => { setPreview(p); setResult(null); } });
  const commit = useMutation({
    mutationFn: () => send('commit'),
    onSuccess: async (p) => {
      setResult(`Tersimpan: ${p.created} PO baru, ${p.updated} PO diperbarui. Termin 1 × 100% dibuat untuk tiap PO.`);
      setPreview(p);
      await qc.invalidateQueries();
    },
  });
  const pending = (preview?.summary.NEW ?? 0) + (preview?.summary.CHANGED ?? 0);
  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        File RAB, baris <b>"Deduction Termin 1 + Addwork"</b> (kolom Realisasi tiap blok). Tanda mengikuti rumus baris "Total after deduction"; sel berumus konstanta
        (mis. <span className="font-mono">=398300-730800</span>) dipecah menjadi Addwork (+) dan Deduction (−).
      </p>
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 hover:bg-slate-50">
          <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
          <span className="text-sm">{file ? file.name : 'Pilih file RAB .xlsx…'}</span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
        </label>
        <button className="btn-primary" disabled={!file || dry.isPending} onClick={() => dry.mutate()}>
          <Upload className="h-4 w-4" /> {dry.isPending ? 'Membaca…' : 'Preview (dry-run)'}
        </button>
      </div>
      <div className="mt-3"><ErrorBox error={dry.error ? errorMessage(dry.error) : commit.error ? errorMessage(commit.error) : null} /></div>
      {result && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{result}</div>}
      {preview && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span>Baru {preview.summary.NEW} · Berubah {preview.summary.CHANGED} · Sama {preview.summary.UNCHANGED} · Cluster tidak ditemukan {preview.summary.NO_CLUSTER}</span>
            <button className="btn-primary" disabled={!pending || commit.isPending} onClick={() => commit.mutate()}>
              {commit.isPending ? 'Menyimpan…' : `Simpan ${pending} PO`}
            </button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Sel</th><th className="th">Cluster</th><th className="th">Jenis</th><th className="th num">Nilai</th><th className="th">Isi sel / rumus total</th><th className="th">Status</th></tr></thead>
              <tbody>
                {preview.items.map((i) => (
                  <tr key={i.key} className="border-t">
                    <td className="td font-mono text-xs">{i.key}</td>
                    <td className="td whitespace-normal">{i.clusterName ?? <span className="text-red-600">{i.blockTitle} (tidak cocok)</span>}</td>
                    <td className="td"><span className={cx('rounded px-1.5 py-0.5 text-xs font-semibold', i.kind === 'DEDUCTION' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>{i.kind === 'DEDUCTION' ? 'Deduction' : 'Addwork'}</span></td>
                    <td className="td num"><Money value={i.amount} plain /></td>
                    <td className="td font-mono text-xs text-slate-500">{i.source} · {i.totalFormula ?? '—'}</td>
                    <td className="td text-xs">{i.status === 'NEW' ? 'Baru' : i.status === 'CHANGED' ? 'Berubah' : i.status === 'UNCHANGED' ? 'Sama' : 'Cluster tidak ditemukan'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Cluster</th><th className="th num">Nilai PO implementasi sekarang</th><th className="th num">Sesudah import</th></tr></thead>
              <tbody>
                {preview.clusters.map((c) => (
                  <tr key={c.clusterId} className="border-t">
                    <td className="td">{c.clusterName}</td>
                    <td className="td num"><Money value={c.nilaiPoImplNow} plain /></td>
                    <td className="td num font-semibold"><Money value={c.nilaiPoImplAfter} plain /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Halaman Import: tab Budget | Penyesuaian PO | RAB Realisasi | Buku Kas. */
export function ImportPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'budget' | 'po' | 'rab' | 'kas'>('budget');
  const tabs: [typeof tab, string, boolean][] = [
    ['budget', 'Budget per Cluster', can('ADMIN', 'PM')],
    ['po', 'Penyesuaian PO', can('ADMIN', 'PM')],
    ['rab', 'RAB Realisasi', can('ADMIN', 'FINANCE')],
    ['kas', 'Buku Kas', can('ADMIN', 'FINANCE')],
  ];
  const visible = tabs.filter((t) => t[2]);
  const active = visible.some((t) => t[0] === tab) ? tab : visible[0]?.[0];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Import Excel" />
      <div className="mb-4 flex gap-1 border-b" role="tablist" aria-label="Jenis import">
        {visible.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={active === k} onClick={() => setTab(k)} className={cx('-mb-px border-b-2 px-4 py-2 text-sm font-medium', active === k ? 'border-brand text-brand' : 'border-transparent text-slate-500')}>
            {label}
          </button>
        ))}
      </div>
      {active === 'budget' && <BudgetImportTab />}
      {active === 'po' && <PoAdjustmentsTab />}
      {active === 'rab' && (
        <div className="space-y-4">
          <HeldItemsPanel />
          <ImportRabTab />
        </div>
      )}
      {active === 'kas' && <ImportLedgerTab />}
    </div>
  );
}
