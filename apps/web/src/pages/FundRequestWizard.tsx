import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Paperclip, Save, Send, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FORM_ATTACHMENT_KINDS, todayJakartaIso, type AttachmentKind, type FrCode } from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import type { Cluster, FrDetail, Project } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { FrSheet, attachmentLabel } from '../components/FrSheet';
import { ErrorBox, Field, Money, PageHeader, Spinner, Toggle, cx } from '../components/ui';
import { pctInputToRatio, ratioToPctInput } from '../lib/format';

const STEPS = ['Cluster', '% Cair per pos', 'Lampiran', 'Review'];

function Stepper({ step, onGo, canGo }: { step: number; onGo: (s: number) => void; canGo: boolean }) {
  return (
    <ol className="mb-4 grid grid-cols-4 gap-1 text-xs sm:gap-2">
      {STEPS.map((s, i) => (
        <li key={s}>
          <button
            type="button"
            disabled={!canGo}
            onClick={() => onGo(i + 1)}
            className={cx(
              'flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 sm:flex-row sm:px-3',
              step === i + 1 ? 'bg-brand text-white' : step > i + 1 ? 'bg-brand-100 text-brand' : 'bg-white text-slate-500',
            )}
          >
            <span className={cx('grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold', step === i + 1 ? 'bg-accent text-brand' : 'bg-slate-200 text-slate-600')}>
              {step > i + 1 ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="truncate">{s}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Langkah 1 untuk pengajuan baru: pilih project & cluster lalu buat draft. */
function NewDraft() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') });
  const [projectId, setProjectId] = useState('');
  const [clusterId, setClusterId] = useState(params.get('cluster') ?? '');
  const [search, setSearch] = useState('');
  const [tanggal, setTanggal] = useState(todayJakartaIso());
  const [kepada, setKepada] = useState('Investor');
  const clusters = useQuery({ queryKey: ['clusters', projectId], queryFn: () => api<(Cluster & { project: { code: string } })[]>(`/clusters${projectId ? `?projectId=${projectId}` : ''}`) });

  const preselected = clusters.data?.find((c) => c.id === clusterId);
  useEffect(() => {
    if (preselected && !projectId) setProjectId(preselected.projectId);
  }, [preselected, projectId]);

  const list = (clusters.data ?? []).filter(
    (c) => c.status !== 'CANCELLED' && (!search || c.name.toLowerCase().includes(search.toLowerCase())),
  );
  const create = useMutation({
    mutationFn: () => api<FrDetail>('/fund-requests', { method: 'POST', json: { clusterId, tanggal, diajukanKepada: kepada } }),
    onSuccess: (fr) => nav(`/pengajuan/${fr.id}/edit?step=2`, { replace: true }),
  });

  return (
    <div className="card space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Project">
          <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setClusterId(''); }}>
            <option value="">Semua project</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.client.name}</option>)}
          </select>
        </Field>
        <Field label="Tanggal pengajuan"><input type="date" className="input" value={tanggal} onChange={(e) => setTanggal(e.target.value)} /></Field>
        <Field label="Diajukan kepada"><input className="input" value={kepada} onChange={(e) => setKepada(e.target.value)} /></Field>
      </div>
      <Field label="Cluster">
        <input className="input mb-2" placeholder="Cari cluster…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      <div className="max-h-80 divide-y overflow-y-auto rounded-lg border" role="listbox" aria-label="Pilih cluster">
        {clusters.isLoading && <Spinner />}
        {list.map((c) => (
          <button
            type="button"
            role="option"
            aria-selected={clusterId === c.id}
            key={c.id}
            onClick={() => setClusterId(c.id)}
            className={cx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50', clusterId === c.id && 'bg-brand-50 ring-2 ring-inset ring-brand')}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="text-xs text-slate-500">{c.project.code} · {c.info ?? ''}</span>
            </span>
            <Money value={c.nilaiPoImpl} className="shrink-0 text-xs text-slate-600" />
          </button>
        ))}
      </div>
      <ErrorBox error={create.error ? errorMessage(create.error) : null} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={!clusterId || create.isPending} onClick={() => create.mutate()}>
          Buat draft &amp; lanjut <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function FundRequestWizard() {
  const { id } = useParams();
  if (!id) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Buat Pengajuan Dana" subtitle="Langkah 1 — pilih cluster" />
        <Stepper step={1} onGo={() => undefined} canGo={false} />
        <NewDraft />
      </div>
    );
  }
  return <EditDraft id={id} />;
}

function EditDraft({ id }: { id: string }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const step = Math.min(4, Math.max(1, Number(params.get('step') ?? 1)));
  const go = (s: number) => setParams({ step: String(s) }, { replace: true });
  const q = useQuery({ queryKey: ['fund-request', id], queryFn: () => api<FrDetail>(`/fund-requests/${id}`) });

  const patch = useMutation({
    mutationFn: (json: object) => api<FrDetail>(`/fund-requests/${id}`, { method: 'PATCH', json }),
    onSuccess: (fr) => qc.setQueryData(['fund-request', id], fr),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return null;
  const fr = q.data;
  if (fr.status !== 'DRAFT') {
    return (
      <div className="card p-6 text-sm">
        Pengajuan ini berstatus final dan tidak bisa diedit. <Link className="text-brand underline" to={`/pengajuan/${id}`}>Lihat detail</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Pengajuan ${fr.label}`}
        subtitle={<>{fr.cluster.name} · {fr.project.code} · termin ke-{fr.terminKe}</>}
        actions={<Link to={`/pengajuan/${id}`} className="btn-ghost">Tutup</Link>}
      />
      <Stepper step={step} onGo={go} canGo />
      {step === 1 && <StepHeader fr={fr} patch={patch} onNext={() => go(2)} />}
      {step === 2 && <StepLines fr={fr} patch={patch} onBack={() => go(1)} onNext={() => go(3)} />}
      {step === 3 && <StepAttachments fr={fr} onBack={() => go(2)} onNext={() => go(4)} />}
      {step === 4 && <StepReview fr={fr} patch={patch} isAdmin={user?.role === 'ADMIN'} onBack={() => go(3)} onDone={(fid) => nav(`/pengajuan/${fid}`)} />}
    </div>
  );
}

type PatchMutation = ReturnType<typeof useMutation<FrDetail, Error, object>>;

function StepHeader({ fr, patch, onNext }: { fr: FrDetail; patch: PatchMutation; onNext: () => void }) {
  const [tanggal, setTanggal] = useState(fr.tanggal);
  const [periode, setPeriode] = useState(fr.periode ?? '');
  const [kepada, setKepada] = useState(fr.diajukanKepada);
  return (
    <div className="card space-y-4 p-4">
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        Cluster: <b>{fr.cluster.name}</b> ({fr.project.code}) · Nilai proyek <Money value={fr.snapshot.nilaiProyek} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tanggal pengajuan" hint="Bulan menentukan nomor FPD saat diajukan.">
          <input type="date" className="input" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </Field>
        <Field label="Periode penggunaan"><input className="input" value={periode} onChange={(e) => setPeriode(e.target.value)} /></Field>
        <Field label="Diajukan kepada"><input className="input" value={kepada} onChange={(e) => setKepada(e.target.value)} /></Field>
      </div>
      <ErrorBox error={patch.error ? errorMessage(patch.error) : null} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={patch.isPending} onClick={() => patch.mutate({ tanggal, periode, diajukanKepada: kepada }, { onSuccess: onNext })}>
          Simpan &amp; lanjut <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StepLines({ fr, patch, onBack, onNext }: { fr: FrDetail; patch: PatchMutation; onBack: () => void; onNext: () => void }) {
  const initial = useMemo(() => Object.fromEntries(fr.lines.map((l) => [l.budgetCode, ratioToPctInput(l.pctCair)])), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pcts, setPcts] = useState<Record<string, string>>(initial);
  const [kets, setKets] = useState<Record<string, string>>(() => Object.fromEntries(fr.lines.map((l) => [l.budgetCode, l.keterangan ?? ''])));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const invalid = Object.entries(pcts).filter(([, v]) => {
    const r = pctInputToRatio(v);
    return r === null || Number(r) < 0 || Number(r) > 1;
  });

  const payload = (p = pcts, k = kets) => ({
    lines: fr.lines.map((l) => ({ budgetCode: l.budgetCode, pctCair: pctInputToRatio(p[l.budgetCode]) ?? '0', keterangan: k[l.budgetCode] || null })),
  });
  const schedule = (p: Record<string, string>, k: Record<string, string>) => {
    clearTimeout(timer.current);
    const bad = Object.values(p).some((v) => {
      const r = pctInputToRatio(v);
      return r === null || Number(r) < 0 || Number(r) > 1;
    });
    if (!bad) timer.current = setTimeout(() => patch.mutate(payload(p, k)), 450);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const setAll = (v: string) => {
    const p = Object.fromEntries(fr.lines.map((l) => [l.budgetCode, v]));
    setPcts(p);
    schedule(p, kets);
  };
  const line = (code: FrCode) => fr.lines.find((l) => l.budgetCode === code)!;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Atur semua pos:</span>
          {['100', '50', '0'].map((v) => <button key={v} className="btn-secondary px-2 py-1 text-xs" onClick={() => setAll(v)}>{v}%</button>)}
          <span className={cx('ml-auto text-xs', patch.isPending ? 'text-amber-600' : 'text-slate-400')}>{patch.isPending ? 'Menghitung…' : 'Tersimpan otomatis'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Pos</th><th className="th num">Budget</th><th className="th num hidden sm:table-cell">Sudah cair</th>
                <th className="th num hidden sm:table-cell">Sedang diproses</th><th className="th w-24">% Cair</th><th className="th num">Diajukan</th>
                <th className="th num hidden md:table-cell">Sisa</th><th className="th hidden lg:table-cell">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {fr.lines.map((l) => {
                const s = line(l.budgetCode);
                const bad = invalid.some(([c]) => c === l.budgetCode);
                return (
                  <tr key={l.budgetCode} className={cx('border-t', s.overBudget && 'bg-red-50')}>
                    <td className="td whitespace-normal">
                      <span className="mr-1 text-[10px] font-bold text-slate-400">{l.section}</span>{l.label}
                    </td>
                    <td className="td num"><Money value={s.budgetAmount} plain /></td>
                    <td className="td num hidden sm:table-cell"><Money value={s.sudahDicairkanSebelum} plain /></td>
                    <td className="td num hidden text-amber-700 sm:table-cell"><Money value={s.sedangDiproses} plain /></td>
                    <td className="td">
                      <input
                        className={cx('input w-20 py-1 text-right', bad && 'border-red-500')}
                        inputMode="decimal"
                        value={pcts[l.budgetCode]}
                        aria-label={`% cair ${l.label}`}
                        onChange={(e) => {
                          const p = { ...pcts, [l.budgetCode]: e.target.value };
                          setPcts(p);
                          schedule(p, kets);
                        }}
                      />
                    </td>
                    <td className="td num font-semibold"><Money value={s.diajukan} plain /></td>
                    <td className={cx('td num hidden md:table-cell', s.overBudget && 'font-bold text-red-600')}><Money value={s.sisaSetelahProses} plain /></td>
                    <td className="td hidden lg:table-cell">
                      <input
                        className="input py-1 text-xs"
                        value={kets[l.budgetCode]}
                        aria-label={`Keterangan ${l.label}`}
                        onChange={(e) => {
                          const k = { ...kets, [l.budgetCode]: e.target.value };
                          setKets(k);
                          schedule(pcts, k);
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t bg-accent font-bold">
                <td className="td">TOTAL</td>
                <td className="td num"><Money value={fr.total.budgetAmount} plain /></td>
                <td className="td num hidden sm:table-cell"><Money value={fr.total.sudahDicairkanSebelum} plain /></td>
                <td className="td num hidden sm:table-cell"><Money value={fr.total.sedangDiproses} plain /></td>
                <td className="td" />
                <td className="td num"><Money value={fr.total.diajukan} plain /></td>
                <td className="td hidden md:table-cell" /><td className="td hidden lg:table-cell" />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Sisa = budget − sudah dicairkan − sedang diproses (pengajuan lain yang belum cair) − diajukan. {fr.terbilang}.
        </p>
        {invalid.length > 0 && <p className="mt-1 text-xs text-red-600">% cair harus angka 0–100.</p>}
        {fr.overBudgetCodes.length > 0 && <p className="mt-1 text-xs text-red-600">Ada pos yang melebihi sisa budget — kurangi % cair.</p>}
        <ErrorBox error={patch.error ? errorMessage(patch.error) : null} />
      </div>
      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Kembali</button>
        <button className="btn-primary" disabled={invalid.length > 0 || patch.isPending} onClick={() => { clearTimeout(timer.current); patch.mutate(payload(), { onSuccess: onNext }); }}>
          Lanjut <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StepAttachments({ fr, onBack, onNext }: { fr: FrDetail; onBack: () => void; onNext: () => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['fund-request', fr.id] });
  const [lainnya, setLainnya] = useState('');
  // Status centang optimistik sampai data server selesai dimuat ulang
  const [optimistic, setOptimistic] = useState<Partial<Record<AttachmentKind, boolean>>>({});
  useEffect(() => setOptimistic({}), [fr.attachments]);
  const add = useMutation({
    mutationFn: ({ kind, file, label, checked }: { kind: AttachmentKind; file?: File; label?: string; checked?: boolean }) => {
      const fd = new FormData();
      fd.set('kind', kind);
      if (label) fd.set('label', label);
      if (checked !== undefined) fd.set('checked', String(checked));
      if (file) fd.set('file', file);
      return api(`/fund-requests/${fr.id}/attachments`, { method: 'POST', body: fd });
    },
    onSuccess: refresh,
  });
  const upd = useMutation({
    mutationFn: ({ attId, checked }: { attId: string; checked: boolean }) => api(`/fund-requests/${fr.id}/attachments/${attId}`, { method: 'PATCH', json: { checked } }),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: (attId: string) => api(`/fund-requests/${fr.id}/attachments/${attId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const toggle = (kind: AttachmentKind, checked: boolean) => {
    setOptimistic((o) => ({ ...o, [kind]: checked }));
    const rows = fr.attachments.filter((a) => a.kind === kind);
    if (!rows.length) add.mutate({ kind, checked });
    else rows.forEach((r) => upd.mutate({ attId: r.id, checked }));
  };

  return (
    <div className="space-y-4">
      <div className="card divide-y">
        {FORM_ATTACHMENT_KINDS.map((kind) => {
          const rows = fr.attachments.filter((a) => a.kind === kind);
          const isChecked = optimistic[kind] ?? rows.some((r) => r.checked || r.hasFile);
          return (
            <div key={kind} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <label className="flex flex-1 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={isChecked} onChange={(e) => toggle(kind, e.target.checked)} />
                {attachmentLabel(kind, fr)}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {rows.filter((r) => r.hasFile).map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
                    <Paperclip className="h-3 w-3" /> {r.fileName}
                    <button aria-label={`Hapus ${r.fileName}`} onClick={() => del.mutate(r.id)}><Trash2 className="h-3 w-3 text-red-500" /></button>
                  </span>
                ))}
                {kind === 'LAINNYA' && (
                  <input className="input w-40 py-1 text-xs" placeholder="Keterangan lainnya" value={lainnya} onChange={(e) => setLainnya(e.target.value)} />
                )}
                <label className="btn-secondary cursor-pointer px-2 py-1 text-xs">
                  <Upload className="h-3.5 w-3.5" /> Unggah
                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf,image/*,.xlsx,.xls,.docx,.doc"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) add.mutate({ kind, file: f, label: kind === 'LAINNYA' ? lainnya || undefined : undefined });
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <ErrorBox error={add.error ? errorMessage(add.error) : upd.error ? errorMessage(upd.error) : del.error ? errorMessage(del.error) : null} />
      <p className="text-xs text-slate-500">Centang lampiran yang disertakan. File bersifat opsional (bisa diserahkan terpisah), maks. 10 MB per file.</p>
      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Kembali</button>
        <button className="btn-primary" onClick={onNext}>Lanjut <ArrowRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function StepReview({ fr, patch, isAdmin, onBack, onDone }: { fr: FrDetail; patch: PatchMutation; isAdmin: boolean; onBack: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [justifikasi, setJustifikasi] = useState(fr.justifikasi);
  const [bank, setBank] = useState(fr.rekeningBank ?? '');
  const [no, setNo] = useState(fr.rekeningNo ?? '');
  const [nama, setNama] = useState(fr.rekeningNama ?? '');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const fields = { justifikasi, rekeningBank: bank || null, rekeningNo: no || null, rekeningNama: nama || null };

  const submit = useMutation({
    mutationFn: async () => {
      await api<FrDetail>(`/fund-requests/${fr.id}`, { method: 'PATCH', json: fields });
      return api<FrDetail>(`/fund-requests/${fr.id}/submit`, { method: 'POST', json: override ? { override: true, overrideReason: reason } : {} });
    },
    onSuccess: async (res) => {
      qc.setQueryData(['fund-request', fr.id], res);
      await qc.invalidateQueries({ queryKey: ['inbox'] });
      await qc.invalidateQueries({ queryKey: ['fund-requests'] });
      onDone(res.id);
    },
  });

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Field label="Tujuan / justifikasi penggunaan dana">
            <textarea className="input" rows={2} value={justifikasi} onChange={(e) => setJustifikasi(e.target.value)} />
          </Field>
        </div>
        <Field label="Nama bank"><input className="input" value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
        <Field label="No. rekening"><input className="input" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field label="Atas nama"><input className="input" value={nama} onChange={(e) => setNama(e.target.value)} /></Field>
      </div>

      <FrSheet fr={fr} />

      {fr.overBudgetCodes.length > 0 && isAdmin && (
        <div className="card space-y-2 border-amber-300 p-4">
          <Toggle checked={override} onChange={setOverride} label="Override validasi sisa budget (Admin)" />
          {override && (
            <Field label="Alasan override"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          )}
        </div>
      )}
      <ErrorBox error={submit.error ? errorMessage(submit.error) : patch.error ? errorMessage(patch.error) : null} />
      <div className="flex flex-wrap justify-between gap-2">
        <button className="btn-secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Kembali</button>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={patch.isPending} onClick={() => patch.mutate(fields, { onSuccess: () => onDone(fr.id) })}>
            <Save className="h-4 w-4" /> Simpan draft
          </button>
          <button
            className="btn-primary"
            disabled={submit.isPending || (fr.overBudgetCodes.length > 0 && !(override && reason.trim())) || Number(fr.total.diajukan) <= 0}
            onClick={() => submit.mutate()}
          >
            <Send className="h-4 w-4" /> {submit.isPending ? 'Mengajukan…' : 'Ajukan'}
          </button>
        </div>
      </div>
    </div>
  );
}
