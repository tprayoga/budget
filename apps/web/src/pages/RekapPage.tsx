import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RotateCcw, Save, Search } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CLUSTER_STATUSES, CLUSTER_STATUS_LABEL, DIVISIONS, sum, type ClusterStatus } from '@indotek/shared';
import { api, download, errorMessage } from '../api/client';
import type { RealisasiSummary, Rekap } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ClusterStatusBadge, ErrorBox, Money, PageHeader, Pct, Spinner, Stat, Toggle, cx } from '../components/ui';
import { recalcProjects, type Assumption } from '../lib/budget';
import { formatRupiah, pctInputToRatio, ratioToPctInput } from '../lib/format';

/** Σ field ringkasan realisasi per cluster (Decimal). */
function sumField(clusters: { realisasi?: RealisasiSummary }[], k: keyof RealisasiSummary): string {
  return sum(clusters.map((c) => c.realisasi?.[k] ?? '0')).toFixed(2);
}

export function RekapPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rekap'], queryFn: () => api<Rekap>('/budget/rekap') });
  const [preview, setPreview] = useState<Assumption | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<ClusterStatus | ''>('');
  const [divFilter, setDivFilter] = useState('');
  const [search, setSearch] = useState('');

  const saved: Assumption | null = q.data ? { interestRate: q.data.global.interestRate, retensiAsCost: q.data.global.retensiAsCost } : null;
  const active = preview ?? saved;
  useEffect(() => {
    if (saved && !preview) setRateInput(ratioToPctInput(saved.interestRate));
  }, [saved?.interestRate, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  const computed = useMemo(() => (q.data && active ? recalcProjects(q.data.projects, active) : null), [q.data, active]);
  const dirty = !!preview && !!saved && (preview.interestRate !== saved.interestRate || preview.retensiAsCost !== saved.retensiAsCost);

  const save = useMutation({
    mutationFn: (a: Assumption) => api('/settings/global', { method: 'PUT', json: a }),
    onSuccess: async () => {
      setPreview(null);
      await qc.invalidateQueries({ queryKey: ['rekap'] });
    },
  });

  const setRate = (v: string) => {
    setRateInput(v);
    const r = pctInputToRatio(v);
    if (r !== null && active) setPreview({ ...active, interestRate: r });
  };

  const filtered = useMemo(() => {
    if (!computed) return [];
    const s = search.trim().toLowerCase();
    return computed.projects
      .filter((p) => !projectFilter || p.project.id === projectFilter)
      .map((p) => ({
        ...p,
        rows: p.clusters.filter(
          (c) =>
            (!statusFilter || c.status === statusFilter) &&
            (!divFilter || (divFilter === '-' ? !c.division : c.division === divFilter)) &&
            (!s || c.name.toLowerCase().includes(s) || (c.info ?? '').toLowerCase().includes(s)),
        ),
      }));
  }, [computed, projectFilter, statusFilter, divFilter, search]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!computed || !active) return null;
  const g = computed.grandTotal;
  const isFiltered = !!(statusFilter || divFilter || search);

  return (
    <div>
      <PageHeader
        title="Rekap Budget per Cluster"
        subtitle="Semua project & cluster. Angka dihitung dengan kalkulasi yang sama dengan server."
        actions={
          <button className="btn-secondary" onClick={() => void download('/export/budget.xlsx', 'Budget.xlsx')}>
            <Download className="h-4 w-4" /> Export Excel
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Nilai Proyek" value={formatRupiah(g.nilaiProyek)} />
        <Stat label="Dana Investor" value={formatRupiah(g.danaInvestor)} />
        <Stat label="Interest" value={formatRupiah(g.interest)} />
        <Stat label="Profit" value={formatRupiah(g.profit)} tone={Number(g.profit) < 0 ? 'neg' : 'pos'} />
        <Stat label="Margin" value={<Pct value={g.margin} />} tone={Number(g.margin) < 0 ? 'neg' : 'pos'} />
      </div>

      <section className={cx('card mb-4 p-4', dirty && 'ring-2 ring-accent')} aria-label="Panel Asumsi">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div>
            <div className="text-sm font-semibold text-slate-800">Asumsi</div>
            <div className="text-xs text-slate-500">
              {dirty ? 'Mode preview — belum disimpan.' : 'Setting global yang berlaku.'}
              {!can('ADMIN') && ' Hanya Admin yang dapat menyimpan; Anda bisa mencoba what-if.'}
            </div>
          </div>
          <label className="w-40">
            <span className="label">Interest (%)</span>
            <input className="input" inputMode="decimal" value={rateInput} onChange={(e) => setRate(e.target.value)} aria-label="Interest rate persen" />
          </label>
          <div className="pb-2">
            <Toggle
              checked={active.retensiAsCost}
              onChange={(v) => setPreview({ ...active, retensiAsCost: v })}
              label="Retensi dihitung sebagai biaya"
            />
          </div>
          <div className="flex gap-2 md:ml-auto">
            {dirty && (
              <button className="btn-ghost" onClick={() => setPreview(null)}>
                <RotateCcw className="h-4 w-4" /> Batalkan preview
              </button>
            )}
            {can('ADMIN') && (
              <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => preview && save.mutate(preview)}>
                <Save className="h-4 w-4" /> Simpan
              </button>
            )}
          </div>
        </div>
        {save.error && <div className="mt-3"><ErrorBox error={errorMessage(save.error)} /></div>}
      </section>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Cari cluster / PO / SPK…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className="input" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Filter project">
          <option value="">Semua project</option>
          {computed.projects.map((p) => (
            <option key={p.project.id} value={p.project.id}>{p.project.code} — {p.project.client.name}</option>
          ))}
        </select>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ClusterStatus | '')} aria-label="Filter status">
          <option value="">Semua status</option>
          {CLUSTER_STATUSES.map((s) => <option key={s} value={s}>{CLUSTER_STATUS_LABEL[s]}</option>)}
        </select>
        <select className="input" value={divFilter} onChange={(e) => setDivFilter(e.target.value)} aria-label="Filter divisi">
          <option value="">Semua divisi</option>
          {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          <option value="-">Tanpa divisi</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="th">Cluster / Site</th>
              <th className="th hidden md:table-cell">Status</th>
              <th className="th num">Nilai Proyek</th>
              <th className="th num">Dana Investor</th>
              <th className="th num hidden sm:table-cell">Interest</th>
              <th className="th num hidden sm:table-cell">Outflow</th>
              <th className="th num">Profit</th>
              <th className="th num">Margin</th>
              <th className="th num hidden lg:table-cell" title="Nilai PO permit − biaya permit − pajak atas permit − interest atas biaya permit">Margin permit</th>
              <th className="th num hidden xl:table-cell" title="Realisasi biaya terverifikasi">Realisasi</th>
              <th className="th num hidden xl:table-cell" title="Pembayaran klien (bruto) − realisasi biaya">Profit realisasi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <Fragment key={p.project.id}>
                <tr className="border-t-2 border-slate-200 bg-brand-50 font-semibold">
                  <td className="td">
                    <Link to={`/projects/${p.project.id}`} className="text-brand hover:underline">
                      TOTAL {p.project.code}
                    </Link>
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {p.project.client.name} · {p.clusters.length} cluster
                      {p.assumption.interestRate !== active.interestRate || p.assumption.retensiAsCost !== active.retensiAsCost ? ' · setting project' : ''}
                    </span>
                  </td>
                  <td className="td hidden md:table-cell" />
                  <td className="td num"><Money value={p.total.nilaiProyek} plain /></td>
                  <td className="td num"><Money value={p.total.danaInvestor} plain /></td>
                  <td className="td num hidden sm:table-cell"><Money value={p.total.interest} plain /></td>
                  <td className="td num hidden sm:table-cell"><Money value={p.total.outflow} plain /></td>
                  <td className="td num"><Money value={p.total.profit} plain /></td>
                  <td className="td num"><Pct value={p.total.margin} /></td>
                  <td className="td num hidden lg:table-cell"><Money value={p.total.marginPermit} plain /></td>
                  <td className="td num hidden xl:table-cell"><Money value={sumField(p.clusters, 'realisasiBiaya')} plain /></td>
                  <td className="td num hidden xl:table-cell"><Money value={sumField(p.clusters, 'profitRealisasi')} plain /></td>
                </tr>
                {p.rows.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="td max-w-[280px] truncate sm:max-w-[420px]">
                      <Link to={`/clusters/${c.id}`} className="hover:text-brand hover:underline" title={c.name}>
                        {c.name}
                      </Link>
                      {c.division && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{c.division}</span>}
                    </td>
                    <td className="td hidden md:table-cell"><ClusterStatusBadge status={c.status} /></td>
                    <td className="td num"><Money value={c.calc.nilaiProyek} plain /></td>
                    <td className="td num"><Money value={c.calc.danaInvestor} plain /></td>
                    <td className="td num hidden sm:table-cell"><Money value={c.calc.interest} plain /></td>
                    <td className="td num hidden sm:table-cell"><Money value={c.calc.outflow} plain /></td>
                    <td className="td num"><Money value={c.calc.profit} plain /></td>
                    <td className="td num"><Pct value={c.calc.margin} /></td>
                    <td className="td num hidden lg:table-cell">{Number(c.calc.nilaiPoPermit) || Number(c.calc.permit.amount) ? <Money value={c.calc.marginPermit} plain /> : <span className="text-slate-300">—</span>}</td>
                    <td className="td num hidden xl:table-cell"><Money value={c.realisasi?.realisasiBiaya ?? null} plain /></td>
                    <td className="td num hidden xl:table-cell"><Money value={c.realisasi?.profitRealisasi ?? null} plain /></td>
                  </tr>
                ))}
                {isFiltered && !p.rows.length && (
                  <tr><td colSpan={11} className="td text-center text-xs text-slate-400">Tidak ada cluster yang cocok dengan filter</td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Baris TOTAL selalu menjumlah semua cluster project (tidak terpengaruh filter).</p>

      <section className="card mt-4 overflow-x-auto" aria-label="Cluster over budget">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Cluster over budget</h2>
          <p className="text-xs text-slate-500">Pos / total cluster dengan realisasi terverifikasi melewati ambang (Setting: realisasi over).</p>
        </div>
        {q.data?.overBudget?.length ? (
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Project</th><th className="th">Cluster</th><th className="th">Pos</th><th className="th num">Budget</th><th className="th num">Realisasi</th><th className="th num">Terpakai</th></tr></thead>
            <tbody>
              {q.data.overBudget.map((o) => (
                <tr key={`${o.clusterId}-${o.code}`} className={cx('border-t', o.code === 'TOTAL' && 'bg-red-50 font-semibold')}>
                  <td className="td">{o.projectCode}</td>
                  <td className="td"><Link to={`/clusters/${o.clusterId}?tab=realisasi`} className="text-brand hover:underline">{o.clusterName}</Link></td>
                  <td className="td">{o.label}</td>
                  <td className="td num"><Money value={o.budget} plain /></td>
                  <td className="td num text-red-700"><Money value={o.realisasi} plain /></td>
                  <td className="td num font-semibold text-red-700">{Number(o.budget) ? <Pct value={o.pctTerpakai} decimals={1} /> : 'budget 0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-slate-500">Tidak ada cluster yang melewati ambang.</p>
        )}
      </section>
    </div>
  );
}
