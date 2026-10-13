import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FilePlus2, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import {
  BUDGET_LABEL,
  BUDGET_LINE_CODES,
  CLUSTER_STATUSES,
  CLUSTER_STATUS_LABEL,
  clusterResultToDto,
  type BudgetLineCode,
} from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import type { Cluster, ClusterDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Field, Modal, Money, PageHeader, Pct, Spinner, StatusBadge, cx } from '../components/ui';
import { calcClusterLocal } from '../lib/budget';
import { formatAngka, formatTanggal, pctInputToRatio, ratioToPctInput, rpInputToValue } from '../lib/format';
import { toUpdatePayload } from '../lib/grid';
import { ClusterRealizationTab } from '../components/realization';
import { ClientPaymentsTab } from '../components/ClientPaymentsTab';
import { ClusterPoTable } from '../components/ClusterPoTable';

const rp = z.string().refine((v) => rpInputToValue(v) !== null, 'Angka tidak valid');
const pct = z.string().refine((v) => pctInputToRatio(v) !== null, 'Persen tidak valid');
const formSchema = z.object({
  name: z.string().trim().min(2, 'Minimal 2 karakter'),
  info: z.string().optional(),
  division: z.enum(['', 'IBK', 'TELCO']),
  status: z.enum(CLUSTER_STATUSES),
  nilaiPoImpl: rp,
  nilaiPoPermit: rp,
  permitCost: rp,
  pajakRate: pct,
  retensiRate: pct,
  implementationDate: z.string().optional(),
  lines: z.array(z.object({ code: z.enum(BUDGET_LINE_CODES), mode: z.enum(['PCT', 'RP']), value: z.string() })),
});
type FormValues = z.infer<typeof formSchema>;

function toForm(c: Cluster): FormValues {
  return {
    name: c.name,
    info: c.info ?? '',
    division: (c.division ?? '') as FormValues['division'],
    status: c.status,
    nilaiPoImpl: formatAngka(c.nilaiPoImpl, 2).replace(/,00$/, ''),
    nilaiPoPermit: formatAngka(c.nilaiPoPermit, 2).replace(/,00$/, ''),
    permitCost: formatAngka(c.permitCost, 2).replace(/,00$/, ''),
    pajakRate: ratioToPctInput(c.pajakRate),
    retensiRate: ratioToPctInput(c.retensiRate),
    implementationDate: c.implementationDate ?? '',
    lines: BUDGET_LINE_CODES.map((code) => {
      const l = c.lines.find((x) => x.code === code);
      const mode = l?.mode ?? 'PCT';
      return { code, mode, value: mode === 'PCT' ? ratioToPctInput(l?.pct ?? '0') : formatAngka(l?.amount ?? '0', 2).replace(/,00$/, '') };
    }),
  };
}

/** Form → Cluster (bila ada nilai yang tidak valid, pakai 0 agar kalkulasi live tetap jalan). */
function fromForm(base: Cluster, v: FormValues): Cluster {
  return {
    ...base,
    name: v.name,
    info: v.info || null,
    division: v.division || null,
    status: v.status,
    nilaiPoImpl: rpInputToValue(v.nilaiPoImpl) ?? '0',
    nilaiPoPermit: rpInputToValue(v.nilaiPoPermit) ?? '0',
    permitCost: rpInputToValue(v.permitCost) ?? '0',
    pajakRate: pctInputToRatio(v.pajakRate) ?? '0',
    retensiRate: pctInputToRatio(v.retensiRate) ?? '0',
    lines: v.lines.map((l) => ({
      code: l.code,
      label: BUDGET_LABEL[l.code],
      mode: l.mode,
      pct: l.mode === 'PCT' ? (pctInputToRatio(l.value) ?? '0') : null,
      amount: l.mode === 'RP' ? (rpInputToValue(l.value) ?? '0') : null,
    })),
  };
}

function Waterfall({ nilaiProyek, danaInvestor, interest, profit }: { nilaiProyek: string; danaInvestor: string; interest: string; profit: string }) {
  const max = Math.max(Number(nilaiProyek), Number(danaInvestor) + Number(interest), 1);
  const w = (v: string) => `${Math.max(0, Math.min(100, (Math.abs(Number(v)) / max) * 100))}%`;
  const di = Number(danaInvestor);
  const bars = [
    { label: 'Nilai Proyek', value: nilaiProyek, left: '0%', width: w(nilaiProyek), color: 'bg-brand' },
    { label: 'Dana Investor', value: danaInvestor, left: '0%', width: w(danaInvestor), color: 'bg-sky-500' },
    { label: 'Interest', value: interest, left: `${(di / max) * 100}%`, width: w(interest), color: 'bg-amber-400' },
    {
      label: 'Profit',
      value: profit,
      left: Number(profit) >= 0 ? `${((di + Number(interest)) / max) * 100}%` : `${(Number(nilaiProyek) / max) * 100}%`,
      width: w(profit),
      color: Number(profit) >= 0 ? 'bg-emerald-500' : 'bg-red-500',
    },
  ];
  return (
    <div className="space-y-2.5" aria-label="Waterfall nilai proyek">
      {bars.map((b) => (
        <div key={b.label}>
          <div className="mb-0.5 flex justify-between text-xs">
            <span className="font-medium text-slate-600">{b.label}</span>
            <Money value={b.value} className="font-semibold" />
          </div>
          <div className="relative h-3 overflow-hidden rounded bg-slate-100">
            <div className={cx('absolute top-0 h-3 rounded', b.color)} style={{ left: b.left, width: b.width }} />
          </div>
        </div>
      ))}
      <p className="text-[11px] text-slate-500">Nilai Proyek − (Dana Investor + Interest) = Profit</p>
    </div>
  );
}

export function ClusterPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const editable = can('ADMIN', 'PM');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cluster', id], queryFn: () => api<ClusterDetail>(`/clusters/${id}`) });
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) });
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState('');
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'budget') as 'budget' | 'realisasi' | 'termin';

  useEffect(() => {
    if (q.data) form.reset(toForm(q.data));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const watched = useWatch({ control: form.control });
  const live = useMemo(() => {
    if (!q.data || !watched.lines) return null;
    const c = fromForm(q.data, watched as FormValues);
    return clusterResultToDto(calcClusterLocal(c, { interestRate: q.data.setting.interestRate, retensiAsCost: q.data.setting.retensiAsCost }));
  }, [watched, q.data]);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['cluster', id] });
    await qc.invalidateQueries({ queryKey: ['rekap'] });
    await qc.invalidateQueries({ queryKey: ['project-budget'] });
  };

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const c = fromForm(q.data!, v);
      return api(`/clusters/${id}`, {
        method: 'PATCH',
        json: { ...toUpdatePayload(c), name: c.name, info: c.info, division: c.division, status: c.status, implementationDate: v.implementationDate || null },
      });
    },
    onSuccess: invalidate,
  });
  const dup = useMutation({
    mutationFn: () => api<{ id: string }>(`/clusters/${id}/duplicate`, { method: 'POST', json: { name: dupName } }),
    onSuccess: async (r) => {
      setDupOpen(false);
      await invalidate();
      nav(`/clusters/${r.id}`);
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/clusters/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rekap'] });
      nav(`/projects/${q.data?.project.id}`);
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || !live) return null;
  const c = q.data;
  const lines = form.watch('lines') ?? [];

  const toggleMode = (idx: number) => {
    const l = lines[idx];
    const calcLine = live.lines[l.code as BudgetLineCode];
    if (l.mode === 'PCT') {
      form.setValue(`lines.${idx}.mode`, 'RP', { shouldDirty: true });
      form.setValue(`lines.${idx}.value`, formatAngka(calcLine.amount, 2).replace(/,00$/, ''), { shouldDirty: true });
    } else {
      form.setValue(`lines.${idx}.mode`, 'PCT', { shouldDirty: true });
      form.setValue(`lines.${idx}.value`, ratioToPctInput(calcLine.pct), { shouldDirty: true });
    }
  };

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={
          <>
            <Link to={`/projects/${c.project.id}`} className="text-brand hover:underline">{c.project.code}</Link> · {c.project.client.name}
            {c.info && <> · {c.info}</>}
          </>
        }
        actions={
          <>
            {can('PM', 'ADMIN') && (
              <Link to={`/pengajuan/baru?cluster=${c.id}`} className="btn-primary">
                <FilePlus2 className="h-4 w-4" /> Buat Pengajuan
              </Link>
            )}
            {editable && (
              <button className="btn-secondary" onClick={() => { setDupName(`${c.name} (salinan)`); setDupOpen(true); }}>
                <Copy className="h-4 w-4" /> Duplikat
              </button>
            )}
            {can('ADMIN') && c.fundRequests.length === 0 && (
              <button className="btn-ghost text-red-600" onClick={() => confirm('Hapus cluster ini?') && del.mutate()}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </>
        }
      />
      <ErrorBox error={del.error ? errorMessage(del.error) : null} />

      <div className="mb-4 flex gap-1 border-b" role="tablist" aria-label="Tab cluster">
        {([['budget', 'Budget'], ['realisasi', 'Realisasi'], ['termin', 'Termin Klien']] as const).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams(k === 'budget' ? {} : { tab: k }, { replace: true })}
            className={cx('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'realisasi' && <ClusterRealizationTab clusterId={c.id} projectId={c.project.id} />}
      {tab === 'termin' && <ClientPaymentsTab clusterId={c.id} />}

      <div className={cx('grid gap-4 lg:grid-cols-3', tab !== 'budget' && 'hidden')}>
        <form
          className="card min-w-0 space-y-4 p-4 lg:col-span-2"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
          aria-label="Form cluster"
        >
          <fieldset disabled={!editable} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nama cluster" error={form.formState.errors.name?.message}><input className="input" {...form.register('name')} /></Field>
              <Field label="Info (SPK / PO / divisi)"><input className="input" {...form.register('info')} /></Field>
              <Field label="Status">
                <select className="input" {...form.register('status')}>
                  {CLUSTER_STATUSES.map((s) => <option key={s} value={s}>{CLUSTER_STATUS_LABEL[s]}</option>)}
                </select>
              </Field>
              <Field label="Tanggal implementasi" hint="Dipakai untuk alokasi biaya ke cluster yang sudah berjalan.">
                <input type="date" className="input" {...form.register('implementationDate')} />
              </Field>
              <Field label="Divisi">
                <select className="input" {...form.register('division')}>
                  <option value="">—</option><option value="IBK">IBK</option><option value="TELCO">TELCO</option>
                </select>
              </Field>
              <Field label="Nilai PO Implementasi (Rp)" hint="Dari tabel PO"><input className="input bg-slate-50 text-right" readOnly tabIndex={-1} {...form.register('nilaiPoImpl')} /></Field>
              <Field label="Nilai PO Permit (Rp)" hint="Dari tabel PO (permit + SND)"><input className="input bg-slate-50 text-right" readOnly tabIndex={-1} {...form.register('nilaiPoPermit')} /></Field>
              <Field label="Biaya Permit (Rp)" hint="Σ biaya pass-through PO"><input className="input bg-slate-50 text-right" readOnly tabIndex={-1} {...form.register('permitCost')} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Pajak (%)" error={form.formState.errors.pajakRate?.message}><input className="input text-right" inputMode="decimal" {...form.register('pajakRate')} /></Field>
                <Field label="Retensi (%)" error={form.formState.errors.retensiRate?.message}><input className="input text-right" inputMode="decimal" {...form.register('retensiRate')} /></Field>
              </div>
            </div>

            <div>
              <div className="label">Baris budget</div>
              <div className="divide-y rounded-lg border">
                {lines.map((l, idx) => {
                  const calcLine = live.lines[l.code as BudgetLineCode];
                  return (
                    <div key={l.code} className="flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap">
                      <span className="w-full text-sm sm:w-56 sm:shrink-0">{BUDGET_LABEL[l.code as BudgetLineCode]}</span>
                      <button
                        type="button"
                        onClick={() => toggleMode(idx)}
                        className={cx('rounded px-2 py-1 text-xs font-bold', l.mode === 'PCT' ? 'bg-brand-100 text-brand' : 'bg-accent-100 text-amber-800')}
                        aria-label={`Ganti mode ${BUDGET_LABEL[l.code as BudgetLineCode]}`}
                      >
                        {l.mode === 'PCT' ? '%' : 'Rp'}
                      </button>
                      <input className="input w-32 text-right sm:w-36" inputMode="decimal" {...form.register(`lines.${idx}.value`)} aria-label={`Nilai ${BUDGET_LABEL[l.code as BudgetLineCode]}`} />
                      <span className="ml-auto text-right text-sm">
                        {l.mode === 'PCT' ? <Money value={calcLine.amount} /> : <Pct value={calcLine.pct} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </fieldset>
          {editable && (
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={save.isPending || !form.formState.isDirty}>
                <Save className="h-4 w-4" /> {save.isPending ? 'Menyimpan…' : 'Simpan'}
              </button>
              {form.formState.isDirty && <span className="text-xs text-amber-700">Ada perubahan belum disimpan — ringkasan sudah dihitung ulang.</span>}
              {save.isSuccess && !form.formState.isDirty && <span className="text-xs text-emerald-700">Tersimpan.</span>}
            </div>
          )}
          <ErrorBox error={save.error ? errorMessage(save.error) : null} />
          {c.overrides.length > 0 && (
            <p className="text-[11px] text-slate-500">
              Dilindungi dari import budget Excel (diedit di aplikasi): {c.overrides.map((o) => o.field).join(', ')}
            </p>
          )}
        </form>

        <div className="min-w-0 space-y-4">
          <section className="card p-4">
            <h2 className="mb-3 font-semibold">Ringkasan</h2>
            <Waterfall nilaiProyek={live.nilaiProyek} danaInvestor={live.danaInvestor} interest={live.interest} profit={live.profit} />
            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Pajak</dt><dd className="text-right"><Money value={live.pajak.amount} /></dd>
              <dt className="text-slate-500">Retensi</dt><dd className="text-right"><Money value={live.retensi.amount} /></dd>
              <dt className="text-slate-500">Cost project</dt><dd className="text-right"><Money value={live.costProject} /></dd>
              <dt className="text-slate-500">Outflow</dt><dd className="text-right"><Money value={live.outflow} /></dd>
              <dt className="font-semibold">Margin</dt><dd className="text-right font-semibold"><Pct value={live.margin} /></dd>
              {Number(live.nilaiPoPermit) !== 0 || Number(live.permit.amount) !== 0 ? (
                <>
                  <dt className="text-slate-500" title="Nilai PO permit − biaya permit − pajak atas permit − interest atas biaya permit">Margin permit</dt>
                  <dd className={cx('text-right font-semibold', Number(live.marginPermit) < 0 && 'text-red-600')} data-testid="margin-permit"><Money value={live.marginPermit} /></dd>
                </>
              ) : null}
            </dl>
            <p className="mt-2 text-[11px] text-slate-500">
              Interest {ratioToPctInput(c.setting.interestRate)}% × dana investor · retensi {c.setting.retensiAsCost ? 'dihitung sebagai biaya' : 'tidak dihitung sebagai biaya'}
            </p>
          </section>

          <section className="card overflow-hidden">
            <h2 className="border-b px-4 py-3 font-semibold">Sisa budget per pos</h2>
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Pos</th><th className="th num">Cair</th><th className="th num">Proses</th><th className="th num">Sisa</th></tr></thead>
              <tbody>
                {c.usage.filter((u) => Number(u.budget) !== 0 || Number(u.sudahDicairkan) !== 0).map((u) => (
                  <tr key={u.code} className="border-t">
                    <td className="td whitespace-normal">{u.label}<div className="text-[11px] text-slate-400">Budget {formatAngka(u.budget)}</div></td>
                    <td className="td num"><Money value={u.sudahDicairkan} plain /></td>
                    <td className="td num text-amber-700"><Money value={u.sedangDiproses} plain /></td>
                    <td className="td num font-semibold"><Money value={u.sisa} plain /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>

      <div className={cx('mt-4', tab !== 'budget' && 'hidden')}>
        <ClusterPoTable clusterId={c.id} pos={c.pos} editable={editable} />
      </div>

      <section className={cx('card mt-4 overflow-hidden', tab !== 'budget' && 'hidden')}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Riwayat pengajuan dana</h2>
          <span className="text-xs text-slate-500">Termin berikutnya: ke-{c.nextTerminKe}</span>
        </div>
        {c.fundRequests.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">Belum ada pengajuan untuk cluster ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Nomor</th><th className="th">Tanggal</th><th className="th">Termin</th><th className="th">Status</th><th className="th num">Total</th></tr></thead>
              <tbody>
                {c.fundRequests.map((f) => (
                  <tr key={f.id} className="border-t hover:bg-slate-50">
                    <td className="td"><Link className="text-brand hover:underline" to={`/pengajuan/${f.id}`}>{f.number ?? 'Draft'}</Link></td>
                    <td className="td">{formatTanggal(f.tanggal)}</td>
                    <td className="td">{f.terminKe}</td>
                    <td className="td"><StatusBadge status={f.status} /></td>
                    <td className="td num"><Money value={f.totalDiajukan} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={dupOpen}
        title="Duplikat cluster"
        onClose={() => setDupOpen(false)}
        footer={<><button className="btn-secondary" onClick={() => setDupOpen(false)}>Batal</button><button className="btn-primary" disabled={dup.isPending || dupName.trim().length < 2} onClick={() => dup.mutate()}>Duplikat</button></>}
      >
        <ErrorBox error={dup.error ? errorMessage(dup.error) : null} />
        <Field label="Nama cluster baru" hint="Semua baris budget disalin; status cluster baru = Rencana.">
          <input className="input" value={dupName} onChange={(e) => setDupName(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
