import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BUDGET_LABEL, ROLE_LABEL, type BudgetLineCode } from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Field, PageHeader, Spinner, Toggle } from '../components/ui';
import { pctInputToRatio, ratioToPctInput } from '../lib/format';

interface GlobalSetting { interestRate: string; retensiAsCost: boolean; rekeningBank: string | null; rekeningNo: string | null; rekeningNama: string | null }
interface Template { effective: { pajakRate: string; retensiRate: string; lines: { code: BudgetLineCode; mode: 'PCT' | 'RP'; pct: string | null; amount: string | null }[] } }

export function SettingsPage() {
  const { user, can } = useAuth();
  const admin = can('ADMIN');
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['settings-global'], queryFn: () => api<GlobalSetting>('/settings/global') });
  const t = useQuery({ queryKey: ['template-global'], queryFn: () => api<Template>('/templates/global') });
  const [form, setForm] = useState({ rate: '', ret: true, bank: '', no: '', nama: '' });
  const [tpl, setTpl] = useState<Record<string, string>>({});

  useEffect(() => {
    if (s.data) setForm({ rate: ratioToPctInput(s.data.interestRate), ret: s.data.retensiAsCost, bank: s.data.rekeningBank ?? '', no: s.data.rekeningNo ?? '', nama: s.data.rekeningNama ?? '' });
  }, [s.data]);
  useEffect(() => {
    if (t.data) {
      const e = t.data.effective;
      setTpl({ pajakRate: ratioToPctInput(e.pajakRate), retensiRate: ratioToPctInput(e.retensiRate), ...Object.fromEntries(e.lines.map((l) => [l.code, ratioToPctInput(l.pct ?? '0')])) });
    }
  }, [t.data]);

  const saveSetting = useMutation({
    mutationFn: () => api('/settings/global', { method: 'PUT', json: { interestRate: pctInputToRatio(form.rate), retensiAsCost: form.ret, rekeningBank: form.bank, rekeningNo: form.no, rekeningNama: form.nama } }),
    onSuccess: async () => { await qc.invalidateQueries(); },
  });
  const saveTpl = useMutation({
    mutationFn: () =>
      api('/templates/global', {
        method: 'PUT',
        json: {
          pajakRate: pctInputToRatio(tpl.pajakRate),
          retensiRate: pctInputToRatio(tpl.retensiRate),
          lines: t.data!.effective.lines.map((l) => ({ code: l.code, mode: 'PCT', pct: pctInputToRatio(tpl[l.code] ?? '0') ?? '0' })),
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['template-global'] }),
  });

  if (s.isLoading || t.isLoading) return <Spinner />;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Pengaturan"
        subtitle={`Masuk sebagai ${user?.name} (${user && ROLE_LABEL[user.role]})${admin ? '' : ' — hanya Admin yang dapat mengubah.'}`}
        actions={<Link to="/ganti-password" className="btn-secondary">Ganti password</Link>}
      />
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Setting global</h2>
        <fieldset disabled={!admin} className="grid gap-3 sm:grid-cols-2">
          <Field label="Interest bank (% × dana investor)"><input className="input" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></Field>
          <div className="pt-6"><Toggle checked={form.ret} onChange={(v) => setForm({ ...form, ret: v })} label="Retensi dihitung sebagai biaya" disabled={!admin} /></div>
          <Field label="Rekening default — bank"><input className="input" value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field>
          <Field label="No. rekening"><input className="input" value={form.no} onChange={(e) => setForm({ ...form, no: e.target.value })} /></Field>
          <Field label="Atas nama"><input className="input" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} /></Field>
        </fieldset>
        <ErrorBox error={saveSetting.error ? errorMessage(saveSetting.error) : null} />
        {admin && <button className="btn-primary" disabled={saveSetting.isPending} onClick={() => saveSetting.mutate()}><Save className="h-4 w-4" /> Simpan setting</button>}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Template default cluster baru</h2>
        <p className="text-xs text-slate-500">Persentase awal saat membuat cluster baru (bisa diubah per cluster). Pajak/retensi dihitung atas nilai proyek / PO implementasi.</p>
        <fieldset disabled={!admin} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[['pajakRate', 'Pajak'], ['retensiRate', 'Retensi'], ...(t.data?.effective.lines ?? []).map((l) => [l.code, BUDGET_LABEL[l.code]])].map(([k, label]) => (
            <Field key={k} label={`${label} (%)`}>
              <input className="input text-right" inputMode="decimal" value={tpl[k] ?? ''} onChange={(e) => setTpl({ ...tpl, [k]: e.target.value })} />
            </Field>
          ))}
        </fieldset>
        <ErrorBox error={saveTpl.error ? errorMessage(saveTpl.error) : null} />
        {admin && <button className="btn-primary" disabled={saveTpl.isPending} onClick={() => saveTpl.mutate()}><Save className="h-4 w-4" /> Simpan template</button>}
      </section>
    </div>
  );
}
