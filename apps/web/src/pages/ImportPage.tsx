import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileSpreadsheet, Upload } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ErrorBox, Money, PageHeader, cx } from '../components/ui';
import { formatPersen } from '../lib/format';

type Status = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'MISSING_IN_FILE';
interface Preview {
  mode: string;
  sheets: { sheetName: string; projectCode: string; projectName: string | null; error: string | null; clusterCount: number; warnings: string[]; summary: Record<Status, number> }[];
  clusters: { key: string; projectCode: string; name: string; column: string | null; status: Status; diffs: { field: string; oldValue: string | null; newValue: string | null }[]; nilaiProyek: string; profit: string }[];
  assumptions: { interestRate: string | null; retensiAsCost: boolean | null };
  created?: number;
  updated?: number;
}

const STATUS_STYLE: Record<Status, string> = {
  NEW: 'bg-emerald-50 text-emerald-700',
  CHANGED: 'bg-amber-50 text-amber-800',
  UNCHANGED: 'bg-slate-100 text-slate-500',
  MISSING_IN_FILE: 'bg-red-50 text-red-600',
};
const STATUS_LABEL: Record<Status, string> = { NEW: 'Baru', CHANGED: 'Berubah', UNCHANGED: 'Sama', MISSING_IN_FILE: 'Tidak ada di file' };

export function ImportPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [result, setResult] = useState<string | null>(null);

  const send = (mode: 'dry-run' | 'commit') => {
    const fd = new FormData();
    fd.set('file', file!);
    if (mode === 'commit') fd.set('keys', JSON.stringify([...selected]));
    return api<Preview>(`/import/budget-xlsx?mode=${mode}`, { method: 'POST', body: fd });
  };
  const dry = useMutation({
    mutationFn: () => send('dry-run'),
    onSuccess: (p) => {
      setPreview(p);
      setResult(null);
      setSelected(new Set(p.clusters.filter((c) => c.status === 'NEW' || c.status === 'CHANGED').map((c) => c.key)));
    },
  });
  const commit = useMutation({
    mutationFn: () => send('commit'),
    onSuccess: async (p) => {
      setResult(`Import selesai: ${p.created} cluster baru, ${p.updated} cluster diperbarui.`);
      setPreview(p);
      setSelected(new Set());
      await qc.invalidateQueries();
    },
  });

  const rows = useMemo(() => (preview?.clusters ?? []).filter((c) => !onlyChanges || c.status !== 'UNCHANGED'), [preview, onlyChanges]);
  const toggle = (set: Set<string>, key: string) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Import Budget dari Excel" subtitle="Layout seperti file Budget_Per_Cluster (sheet per project: ADW, EVANTAMA, CCSI). Dry-run dulu, lalu commit." />
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
            <button className="btn-primary" disabled={!selected.size || commit.isPending} onClick={() => commit.mutate()}>
              {commit.isPending ? 'Menyimpan…' : `Commit ${selected.size} cluster`}
            </button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th w-8" /><th className="th">Cluster</th><th className="th">Status</th><th className="th num">Nilai proyek</th><th className="th num">Profit</th></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const selectable = c.status === 'NEW' || c.status === 'CHANGED';
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
                                  <tr key={d.field}>
                                    <td className="pr-4 font-mono">{d.field}</td>
                                    <td className="pr-2 text-red-600 line-through">{d.oldValue ?? '∅'}</td>
                                    <td className="text-emerald-700">→ {d.newValue ?? '∅'}</td>
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
