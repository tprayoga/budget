import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Download, Plus, RotateCcw, Save, Search } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BUDGET_LABEL,
  CLUSTER_STATUSES,
  CLUSTER_STATUS_LABEL,
  COST_PROJECT_CODES,
  calcProjectTotal,
  clusterResultToDto,
  projectTotalToDto,
  safeDiv,
  type BudgetLineCode,
  type CalcSummaryDto,
  type ClusterCalcResult,
  type ClusterStatus,
} from '@indotek/shared';
import { api, download, errorMessage } from '../api/client';
import type { Cluster, ProjectBudget } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, cx } from '../components/ui';
import { calcClusterLocal, effectiveAssumption, type Assumption } from '../lib/budget';
import { formatAngka, formatPersen, isNegative, pctInputToRatio, ratioToPctInput, rpInputToValue } from '../lib/format';
import { isClusterChanged, setField, setLineValue, toggleLineMode, toUpdatePayload, type ClusterField } from '../lib/grid';

/** Definisi baris grid (urutan mengikuti sheet Excel). */
type RowDef =
  | { key: string; label: string; kind: 'field-rp'; field: 'nilaiPoImpl' | 'nilaiPoPermit' | 'permitCost'; pct?: (c: CalcSummaryDto) => string }
  | { key: string; label: string; kind: 'field-pct'; field: 'pajakRate' | 'retensiRate'; rp: (c: CalcSummaryDto) => string }
  | { key: string; label: string; kind: 'line'; code: BudgetLineCode }
  | { key: string; label: string; kind: 'calc'; rp: (c: CalcSummaryDto) => string; pct?: (c: CalcSummaryDto) => string; strong?: boolean }
  | { key: string; label: string; kind: 'header' };

const div = (a: string, b: string) => safeDiv(a, b).toString();

const ROWS: RowDef[] = [
  { key: 'nilaiPoImpl', label: 'Nilai PO Implementasi', kind: 'field-rp', field: 'nilaiPoImpl' },
  { key: 'nilaiPoPermit', label: 'Nilai PO Permit', kind: 'field-rp', field: 'nilaiPoPermit' },
  { key: 'nilaiProyek', label: 'Nilai Proyek', kind: 'calc', rp: (c) => c.nilaiProyek, strong: true },
  { key: 'danaInvestor', label: 'Dana Investor', kind: 'calc', rp: (c) => c.danaInvestor, pct: (c) => div(c.danaInvestor, c.nilaiProyek), strong: true },
  { key: 'SUBCON', label: BUDGET_LABEL.SUBCON, kind: 'line', code: 'SUBCON' },
  { key: 'permitCost', label: BUDGET_LABEL.PERMIT, kind: 'field-rp', field: 'permitCost', pct: (c) => c.permit.pct },
  { key: 'TICKET', label: BUDGET_LABEL.TICKET, kind: 'line', code: 'TICKET' },
  { key: 'interest', label: 'Interest Bank', kind: 'calc', rp: (c) => c.interest },
  { key: 'pajakRate', label: 'Pajak (× Nilai Proyek)', kind: 'field-pct', field: 'pajakRate', rp: (c) => c.pajak.amount },
  { key: 'retensiRate', label: 'Retensi (× PO Impl.)', kind: 'field-pct', field: 'retensiRate', rp: (c) => c.retensi.amount },
  { key: 'h-cost', label: 'COST PROJECT', kind: 'header' },
  ...COST_PROJECT_CODES.map((code): RowDef => ({ key: code, label: BUDGET_LABEL[code], kind: 'line', code })),
  { key: 'outflow', label: 'Outflow', kind: 'calc', rp: (c) => c.outflow, pct: (c) => div(c.outflow, c.nilaiProyek), strong: true },
  { key: 'profit', label: 'Profit', kind: 'calc', rp: (c) => c.profit, pct: (c) => c.margin, strong: true },
  { key: 'marginPermit', label: 'Margin permit', kind: 'calc', rp: (c) => c.marginPermit },
];

interface ColData {
  cluster: Cluster;
  result: ClusterCalcResult;
  calc: CalcSummaryDto;
  dirty: boolean;
}

/** Sel input yang bisa diedit inline: klik → input; Enter/blur simpan ke draft, Esc batal. */
function EditableValue({
  display,
  initial,
  onCommit,
  disabled,
  ariaLabel,
  mode,
}: {
  display: React.ReactNode;
  initial: string;
  onCommit: (v: string) => boolean;
  disabled?: boolean;
  ariaLabel: string;
  mode: 'pct' | 'rp';
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial);
  const [bad, setBad] = useState(false);
  if (disabled) return <span>{display}</span>;
  if (!editing) {
    return (
      <button
        type="button"
        className="w-full rounded px-1 text-right underline decoration-dotted decoration-slate-300 underline-offset-4 hover:bg-accent-100"
        onClick={() => {
          setVal(initial);
          setBad(false);
          setEditing(true);
        }}
        aria-label={ariaLabel}
      >
        {display}
      </button>
    );
  }
  const commit = () => {
    if (val.trim() === initial.trim() || onCommit(val)) setEditing(false);
    else setBad(true);
  };
  return (
    <input
      autoFocus
      className={cx('w-full rounded border px-1 py-0.5 text-right text-sm tabular-nums outline-none', bad ? 'border-red-500' : 'border-brand')}
      value={val}
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={mode === 'pct' ? '%' : 'Rp'}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

function Num({ v, className }: { v: string; className?: string }) {
  return <span className={cx('tabular-nums', isNegative(v) && 'text-red-600', className)}>{formatAngka(v)}</span>;
}
function P({ v }: { v: string }) {
  return <span className={cx('text-[11px] tabular-nums text-slate-500', isNegative(v) && 'text-red-500')}>{formatPersen(v)}</span>;
}

export function ProjectPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const editable = can('ADMIN', 'PM');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['project-budget', id], queryFn: () => api<ProjectBudget>(`/projects/${id}/budget`) });
  const [edits, setEdits] = useState<Record<string, Cluster>>({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClusterStatus | ''>('');
  const [addOpen, setAddOpen] = useState(false);
  /** Preview what-if setting project (tidak disimpan). */
  const [preview, setPreview] = useState<Assumption | null>(null);

  const saved = q.data ? effectiveAssumption(q.data.setting, { interestRate: q.data.setting.interestRate, retensiAsCost: q.data.setting.retensiAsCost }) : null;
  const assumption = preview ?? saved;

  const cols: ColData[] = useMemo(() => {
    if (!q.data || !assumption) return [];
    return q.data.clusters.map((server) => {
      const cluster = edits[server.id] ?? server;
      const result = calcClusterLocal(cluster, assumption);
      return { cluster, result, calc: clusterResultToDto(result), dirty: !!edits[server.id] && isClusterChanged(cluster, server) };
    });
  }, [q.data, edits, assumption?.interestRate, assumption?.retensiAsCost]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = cols.filter(
    (c) => (!status || c.cluster.status === status) && (!search || c.cluster.name.toLowerCase().includes(search.toLowerCase())),
  );
  const dirtyCols = cols.filter((c) => c.dirty);

  // TOTAL = penjumlahan hasil presisi penuh semua cluster (tidak terpengaruh filter), lalu dibulatkan
  const totalCalc = useMemo(() => (cols.length ? projectTotalToDto(calcProjectTotal(cols.map((c) => c.result))) : null), [cols]);

  const update = (clusterId: string, fn: (c: Cluster) => Cluster) => {
    const server = q.data!.clusters.find((c) => c.id === clusterId)!;
    setEdits((e) => ({ ...e, [clusterId]: fn(e[clusterId] ?? server) }));
  };

  const save = useMutation({
    mutationFn: async () => {
      for (const c of dirtyCols) {
        await api(`/clusters/${c.cluster.id}`, { method: 'PATCH', json: toUpdatePayload(c.cluster) });
      }
    },
    onSuccess: async () => {
      setEdits({});
      await qc.invalidateQueries({ queryKey: ['project-budget', id] });
      await qc.invalidateQueries({ queryKey: ['rekap'] });
    },
  });

  const helper = createColumnHelper<RowDef>();
  const columns = useMemo(
    () => [
      helper.display({
        id: 'label',
        header: () => 'Pos',
        cell: ({ row }) => (
          <span className={cx(row.original.kind === 'header' && 'text-xs font-bold uppercase tracking-wide text-slate-500', row.original.kind === 'calc' && row.original.strong && 'font-semibold')}>
            {row.original.label}
          </span>
        ),
      }),
      helper.display({
        id: 'total',
        header: () => <div className="text-right">TOTAL</div>,
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind === 'header' || !totalCalc) return null;
          const t = totalFor(r, totalCalc);
          return (
            <div className="text-right font-semibold">
              <Num v={t.rp} />
              {t.pct !== null && <div><P v={t.pct} /></div>}
            </div>
          );
        },
      }),
      ...visible.map((col) =>
        helper.display({
          id: col.cluster.id,
          header: () => (
            <div className="w-40 text-right">
              <Link to={`/clusters/${col.cluster.id}`} className="line-clamp-2 whitespace-normal text-left font-semibold normal-case tracking-normal text-brand hover:underline" title={col.cluster.name}>
                {col.cluster.name}
              </Link>
              <div className="mt-0.5 flex items-center justify-between text-[10px] font-normal normal-case tracking-normal text-slate-400">
                <span>{col.cluster.division ?? ''} {CLUSTER_STATUS_LABEL[col.cluster.status]}</span>
                {col.dirty && <span className="rounded bg-accent px-1 font-semibold text-brand">diubah</span>}
              </div>
            </div>
          ),
          cell: ({ row }) => <GridCell row={row.original} col={col} editable={editable} update={update} />,
        }),
      ),
    ],
    [visible, totalCalc, editable], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const table = useReactTable({ data: ROWS, columns, getCoreRowModel: getCoreRowModel() });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return null;
  const p = q.data.project;

  return (
    <div>
      <PageHeader
        title={`${p.code} — ${p.name}`}
        subtitle={
          <>
            {p.client.name} · {q.data.clusters.length} cluster · Interest {formatPersen(q.data.setting.interestRate, 0)} · Retensi{' '}
            {q.data.setting.retensiAsCost ? 'sebagai biaya' : 'bukan biaya'}
            {q.data.setting.overridden.length > 0 && ' (setting project)'}
          </>
        }
        actions={
          <>
            <button className="btn-secondary" onClick={() => void download(`/export/projects/${id}/budget.xlsx`, `Budget_${p.code}.xlsx`)}>
              <Download className="h-4 w-4" /> Export
            </button>
            {editable && (
              <button className="btn-primary" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Cluster
              </button>
            )}
          </>
        }
      />

      <ProjectSettingPanel
        projectId={id}
        canSave={can('ADMIN', 'DIREKTUR')}
        current={assumption!}
        previewing={!!preview}
        onPreview={setPreview}
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Cari cluster…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className="input sm:w-48" value={status} onChange={(e) => setStatus(e.target.value as ClusterStatus | '')} aria-label="Filter status">
          <option value="">Semua status</option>
          {CLUSTER_STATUSES.map((s) => <option key={s} value={s}>{CLUSTER_STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      {editable && (
        <p className="mb-2 text-xs text-slate-500">
          Klik angka bergaris untuk mengedit. Tombol <b>%</b>/<b>Rp</b> mengganti mode sel (nilai rupiah dipertahankan). Perubahan dihitung langsung; tekan Simpan untuk menyimpan.
        </p>
      )}

      <div className="card relative max-h-[70vh] overflow-auto" data-testid="project-grid">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h, i) => (
                  <th
                    key={h.id}
                    className={cx(
                      'sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-slate-500',
                      i === 0 && 'left-0 z-30 min-w-[150px] sm:min-w-[220px]',
                      i === 1 && 'min-w-[130px] bg-brand-50 sm:sticky sm:left-[220px] sm:z-30',
                    )}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={cx(row.original.kind === 'calc' && row.original.strong && 'bg-slate-50/70')}>
                {row.getVisibleCells().map((cell, i) => (
                  <td
                    key={cell.id}
                    className={cx(
                      'border-b border-slate-100 px-2 py-1.5 align-top',
                      i === 0 && 'sticky left-0 z-10 bg-white',
                      i === 1 && 'bg-brand-50/60 sm:sticky sm:left-[220px] sm:z-10 sm:bg-brand-50',
                      i > 1 && 'text-right',
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dirtyCols.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-40 mx-auto flex max-w-xl items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg lg:bottom-6">
          <span className="text-sm"><b>{dirtyCols.length}</b> cluster diubah</span>
          {save.error && <span className="truncate text-xs text-red-600">{errorMessage(save.error)}</span>}
          <button className="btn-ghost ml-auto" onClick={() => setEdits({})}>
            <RotateCcw className="h-4 w-4" /> Batal
          </button>
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4" /> {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      )}

      <AddClusterModal open={addOpen} onClose={() => setAddOpen(false)} projectId={id} />
    </div>
  );
}

/** Nilai kolom TOTAL untuk satu baris, dari DTO total project. */
function totalFor(r: RowDef, t: CalcSummaryDto): { rp: string; pct: string | null } {
  switch (r.kind) {
    case 'field-rp':
      if (r.field === 'permitCost') return { rp: t.permit.amount, pct: t.permit.pct };
      return { rp: r.field === 'nilaiPoImpl' ? t.nilaiPoImpl : t.nilaiPoPermit, pct: null };
    case 'field-pct':
      return r.field === 'pajakRate' ? { rp: t.pajak.amount, pct: t.pajak.pct } : { rp: t.retensi.amount, pct: t.retensi.pct };
    case 'line':
      return { rp: t.lines[r.code].amount, pct: t.lines[r.code].pct };
    case 'calc':
      return { rp: r.rp(t), pct: r.pct ? r.pct(t) : null };
    default:
      return { rp: '0', pct: null };
  }
}

function GridCell({ row, col, editable, update }: { row: RowDef; col: ColData; editable: boolean; update: (id: string, fn: (c: Cluster) => Cluster) => void }) {
  const c = col.cluster;
  switch (row.kind) {
    case 'header':
      return null;
    case 'calc':
      return (
        <div className={cx(row.strong && 'font-semibold')}>
          <Num v={row.rp(col.calc)} />
          {row.pct && <div><P v={row.pct(col.calc)} /></div>}
        </div>
      );
    case 'field-rp': {
      // Fase 2.3: diturunkan dari tabel PO cluster — hanya tampil (ubah lewat detail cluster)
      const value = c[row.field];
      return (
        <div title="Diturunkan dari tabel PO — ubah di detail cluster">
          <Num v={value} className="font-medium" />
          {row.pct && <div><P v={row.pct(col.calc)} /></div>}
        </div>
      );
    }
    case 'field-pct': {
      const value = c[row.field];
      return (
        <div>
          <EditableValue
            disabled={!editable}
            mode="pct"
            ariaLabel={`${row.label} ${c.name}`}
            initial={ratioToPctInput(value)}
            display={<span className="font-medium tabular-nums">{formatPersen(value)}</span>}
            onCommit={(v) => {
              const parsed = pctInputToRatio(v);
              if (parsed === null || Number(parsed) < 0) return false;
              update(c.id, (x) => setField(x, row.field as ClusterField, parsed));
              return true;
            }}
          />
          <div className="text-[11px] text-slate-500"><Num v={row.rp(col.calc)} /></div>
        </div>
      );
    }
    case 'line': {
      const line = c.lines.find((l) => l.code === row.code);
      const mode = line?.mode ?? 'PCT';
      const lc = col.calc.lines[row.code];
      return (
        <div className="flex items-start gap-1">
          {editable && (
            <button
              type="button"
              className={cx('mt-0.5 rounded px-1 text-[10px] font-bold', mode === 'PCT' ? 'bg-brand-100 text-brand' : 'bg-accent-100 text-amber-800')}
              title={mode === 'PCT' ? 'Mode persen — klik untuk ganti ke Rp' : 'Mode rupiah — klik untuk ganti ke %'}
              aria-label={`Ganti mode ${row.label} ${c.name}`}
              onClick={() => update(c.id, (x) => toggleLineMode(x, row.code, col.result))}
            >
              {mode === 'PCT' ? '%' : 'Rp'}
            </button>
          )}
          <div className="flex-1">
            {mode === 'PCT' ? (
              <>
                <EditableValue
                  disabled={!editable}
                  mode="pct"
                  ariaLabel={`${row.label} ${c.name}`}
                  initial={ratioToPctInput(line?.pct ?? '0')}
                  display={<span className="font-medium tabular-nums">{formatPersen(lc.pct)}</span>}
                  onCommit={(v) => {
                    const parsed = pctInputToRatio(v);
                    if (parsed === null || Number(parsed) < 0) return false;
                    update(c.id, (x) => setLineValue(x, row.code, parsed));
                    return true;
                  }}
                />
                <div className="text-[11px] text-slate-500"><Num v={lc.amount} /></div>
              </>
            ) : (
              <>
                <EditableValue
                  disabled={!editable}
                  mode="rp"
                  ariaLabel={`${row.label} ${c.name}`}
                  initial={formatAngka(line?.amount ?? '0', 2).replace(/,00$/, '')}
                  display={<Num v={lc.amount} className="font-medium" />}
                  onCommit={(v) => {
                    const parsed = rpInputToValue(v);
                    if (parsed === null || Number(parsed) < 0) return false;
                    update(c.id, (x) => setLineValue(x, row.code, parsed));
                    return true;
                  }}
                />
                <P v={lc.pct} />
              </>
            )}
          </div>
        </div>
      );
    }
  }
}

/**
 * Setting khusus project. ADMIN & DIREKTUR dapat menyimpan (tercatat di audit log);
 * role lain hanya bisa mencoba preview what-if tanpa menyimpan.
 */
function ProjectSettingPanel({
  projectId,
  canSave,
  current,
  previewing,
  onPreview,
}: {
  projectId: string;
  canSave: boolean;
  current: Assumption;
  previewing: boolean;
  onPreview: (a: Assumption | null) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['project-setting', projectId],
    queryFn: () =>
      api<{ override: { interestRate: string | null; retensiAsCost: boolean | null } | null; effective: { interestRate: string; retensiAsCost: boolean } }>(
        `/projects/${projectId}/settings`,
      ),
  });
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState('');
  const [useRate, setUseRate] = useState(false);
  const [ret, setRet] = useState<boolean | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}/settings`, {
        method: 'PUT',
        json: { interestRate: useRate ? pctInputToRatio(rate) : null, retensiAsCost: ret },
      }),
    onSuccess: async () => {
      setOpen(false);
      onPreview(null);
      await qc.invalidateQueries({ queryKey: ['project-setting', projectId] });
      await qc.invalidateQueries({ queryKey: ['project-budget', projectId] });
      await qc.invalidateQueries({ queryKey: ['rekap'] });
    },
  });
  if (!q.data) return null;
  const o = q.data.override;
  const global = q.data.effective;
  const applyPreview = () => {
    const r = useRate ? pctInputToRatio(rate) : null;
    onPreview({ interestRate: r ?? global.interestRate, retensiAsCost: ret ?? global.retensiAsCost });
    setOpen(false);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <button
        className="text-brand underline-offset-2 hover:underline"
        onClick={() => {
          setUseRate(o?.interestRate != null || previewing);
          setRate(ratioToPctInput(current.interestRate));
          setRet(o?.retensiAsCost ?? (previewing ? current.retensiAsCost : null));
          setOpen(true);
        }}
      >
        {canSave ? 'Atur setting khusus project ini' : 'Coba what-if setting project'}
      </button>
      {previewing && (
        <span className="inline-flex items-center gap-2 rounded-lg bg-accent-100 px-2 py-1 text-xs text-amber-900">
          Mode preview: interest {formatPersen(current.interestRate)} · retensi {current.retensiAsCost ? 'biaya' : 'bukan biaya'} — belum disimpan
          <button className="font-semibold underline" onClick={() => onPreview(null)}>Batalkan</button>
        </span>
      )}
      <Modal
        open={open}
        title={canSave ? 'Setting project (override global)' : 'What-if setting project'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setOpen(false)}>Batal</button>
            <button className="btn-secondary" disabled={useRate && pctInputToRatio(rate) === null} onClick={applyPreview}>Preview</button>
            {canSave && (
              <button className="btn-primary" disabled={m.isPending || (useRate && pctInputToRatio(rate) === null)} onClick={() => m.mutate()}>Simpan</button>
            )}
          </>
        }
      >
        {!canSave && <p className="text-xs text-slate-500">Hanya Admin & Direktur yang dapat menyimpan setting project. Preview tidak disimpan.</p>}
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
        <Toggle checked={useRate} onChange={setUseRate} label="Interest khusus project" />
        {useRate && (
          <Field label="Interest (%)">
            <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Interest project persen" />
          </Field>
        )}
        <Field label="Retensi sebagai biaya">
          <select className="input" value={ret === null ? '' : String(ret)} onChange={(e) => setRet(e.target.value === '' ? null : e.target.value === 'true')}>
            <option value="">Ikut setting global</option>
            <option value="true">Ya</option>
            <option value="false">Tidak</option>
          </select>
        </Field>
      </Modal>
    </div>
  );
}

function AddClusterModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [info, setInfo] = useState('');
  const [po, setPo] = useState('');
  const [division, setDivision] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api('/clusters', {
        method: 'POST',
        json: { projectId, name, info: info || null, nilaiPoImpl: rpInputToValue(po) ?? '0', division: division || null, status: 'PLAN' },
      }),
    onSuccess: async () => {
      setName('');
      setInfo('');
      setPo('');
      onClose();
      await qc.invalidateQueries({ queryKey: ['project-budget', projectId] });
      await qc.invalidateQueries({ queryKey: ['rekap'] });
    },
  });
  return (
    <Modal
      open={open}
      title="Tambah cluster"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>Simpan</button>
        </>
      }
    >
      <ErrorBox error={m.error ? errorMessage(m.error) : null} />
      <Field label="Nama cluster / site"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Info (SPK / PO)"><input className="input" value={info} onChange={(e) => setInfo(e.target.value)} /></Field>
      <Field label="Nilai PO Implementasi (Rp)" hint="Persentase biaya diisi otomatis dari template default; bisa diubah setelahnya.">
        <input className="input" inputMode="numeric" value={po} onChange={(e) => setPo(e.target.value)} placeholder="mis. 9.440.850" />
      </Field>
      <Field label="Divisi">
        <select className="input" value={division} onChange={(e) => setDivision(e.target.value)}>
          <option value="">—</option>
          <option value="IBK">IBK</option>
          <option value="TELCO">TELCO</option>
        </select>
      </Field>
    </Modal>
  );
}
