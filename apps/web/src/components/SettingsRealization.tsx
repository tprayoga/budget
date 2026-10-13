import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BUDGET_LABEL, EXPENSE_CATEGORY_LABEL, FR_CODES, type ExpenseCategory, type FrCode } from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { formatPersen, formatTanggal, pctInputToRatio, ratioToPctInput } from '../lib/format';
import { ErrorBox, Field, Modal } from './ui';

interface Template { id: string; client: { id: string; name: string }; kind: 'IMPLEMENTASI' | 'PERMIT'; agingDays: number | null; agingType: 'CALENDAR' | 'WORKING' | null; lines: { terminKe: number; pct: string; keterangan: string | null }[] }

export function CategoryMappingSection() {
  const { can } = useAuth();
  const admin = can('ADMIN');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['category-mappings'], queryFn: () => api<{ category: ExpenseCategory; budgetCode: FrCode | null }[]>('/category-mappings') });
  const [rows, setRows] = useState<{ category: ExpenseCategory; budgetCode: FrCode | null }[]>([]);
  useEffect(() => q.data && setRows(q.data), [q.data]);
  const save = useMutation({ mutationFn: () => api('/category-mappings', { method: 'PUT', json: rows }), onSuccess: () => qc.invalidateQueries({ queryKey: ['category-mappings'] }) });
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-semibold">Mapping kategori realisasi → pos budget</h2>
      <fieldset disabled={!admin} className="grid gap-2 sm:grid-cols-2">
        {rows.map((r, i) => (
          <label key={r.category} className="flex items-center gap-2 text-sm">
            <span className="w-40 shrink-0">{EXPENSE_CATEGORY_LABEL[r.category]}</span>
            <select className="input py-1" value={r.budgetCode ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, budgetCode: (e.target.value || null) as FrCode | null } : x)))} aria-label={`Pos untuk ${EXPENSE_CATEGORY_LABEL[r.category]}`}>
              <option value="">(pilih manual saat input)</option>
              {FR_CODES.map((c) => <option key={c} value={c}>{BUDGET_LABEL[c]}</option>)}
            </select>
          </label>
        ))}
      </fieldset>
      <ErrorBox error={save.error ? errorMessage(save.error) : null} />
      {admin && <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Simpan mapping</button>}
    </section>
  );
}

export function WarnPctSection({ value, overValue }: { value: string | null | undefined; overValue?: string | null }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [v, setV] = useState(ratioToPctInput(value ?? '0.8'));
  const [over, setOver] = useState(ratioToPctInput(overValue ?? '1'));
  useEffect(() => setV(ratioToPctInput(value ?? '0.8')), [value]);
  useEffect(() => setOver(ratioToPctInput(overValue ?? '1')), [overValue]);
  const save = useMutation({
    mutationFn: () => api('/settings/global', { method: 'PUT', json: { realisasiWarnPct: pctInputToRatio(v), realisasiOverPct: pctInputToRatio(over) } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Ambang kuning realisasi (%)" hint="Merah bila > 100%.">
        <input className="input w-32" inputMode="decimal" value={v} disabled={!can('ADMIN')} onChange={(e) => setV(e.target.value)} />
      </Field>
      <Field label="Ambang notifikasi over budget (%)" hint="Notifikasi PM & Direktur + daftar di Rekap.">
        <input className="input w-32" inputMode="decimal" value={over} disabled={!can('ADMIN')} onChange={(e) => setOver(e.target.value)} aria-label="Ambang over budget" />
      </Field>
      {can('ADMIN') && <button className="btn-secondary mb-0.5" disabled={save.isPending} onClick={() => save.mutate()}>Simpan</button>}
      <ErrorBox error={save.error ? errorMessage(save.error) : null} />
    </div>
  );
}

export function TerminTemplateSection() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['termin-templates'], queryFn: () => api<Template[]>('/termin-templates') });
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api<{ id: string; name: string }[]>('/clients') });
  const [edit, setEdit] = useState<{ clientId: string; kind: 'IMPLEMENTASI' | 'PERMIT'; agingDays: string; agingType: '' | 'CALENDAR' | 'WORKING'; pcts: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api('/termin-templates', {
        method: 'PUT',
        json: {
          clientId: edit!.clientId,
          kind: edit!.kind,
          agingDays: edit!.agingDays ? Number(edit!.agingDays) : null,
          agingType: edit!.agingType || null,
          lines: edit!.pcts.split('/').map((p) => ({ pct: pctInputToRatio(p.trim()) ?? '0' })),
        },
      }),
    onSuccess: () => { setEdit(null); void qc.invalidateQueries({ queryKey: ['termin-templates'] }); },
  });
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Template termin pembayaran klien</h2>
        {can('ADMIN') && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setEdit({ clientId: clients.data?.[0]?.id ?? '', kind: 'IMPLEMENTASI', agingDays: '', agingType: '', pcts: '' })}><Plus className="h-3.5 w-3.5" /> Template</button>}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="th">Client</th><th className="th">Jenis</th><th className="th">Termin</th><th className="th">Jatuh tempo</th><th className="th" /></tr></thead>
        <tbody>
          {q.data?.map((t) => (
            <tr key={t.id} className="border-t">
              <td className="td">{t.client.name}</td>
              <td className="td">{t.kind === 'PERMIT' ? 'Permit' : 'Implementasi'}</td>
              <td className="td">{t.lines.map((l) => formatPersen(l.pct, 0)).join(' / ')}</td>
              <td className="td">{t.agingDays != null ? `${t.agingDays} hari ${t.agingType === 'WORKING' ? 'kerja' : 'kalender'}` : 'manual'}</td>
              <td className="td">{can('ADMIN') && <button className="text-xs text-brand underline" onClick={() => setEdit({ clientId: t.client.id, kind: t.kind, agingDays: t.agingDays?.toString() ?? '', agingType: t.agingType ?? '', pcts: t.lines.map((l) => ratioToPctInput(l.pct)).join('/') })}>Ubah</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">Template dipakai saat cluster dibuat. Perubahan template tidak mengubah termin yang sudah ada (pakai "hitung ulang" di cluster).</p>
      <Modal open={!!edit} title="Template termin" onClose={() => setEdit(null)} footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Simpan</button></>}>
        <ErrorBox error={save.error ? errorMessage(save.error) : null} />
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client"><select className="input" value={edit.clientId} onChange={(e) => setEdit({ ...edit, clientId: e.target.value })}>{clients.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Jenis"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as 'IMPLEMENTASI' | 'PERMIT' })}><option value="IMPLEMENTASI">Implementasi</option><option value="PERMIT">Permit</option></select></Field>
            <Field label="Persentase termin (pisah /)" hint="mis. 20/30/40/10 — total 100%"><input className="input" value={edit.pcts} onChange={(e) => setEdit({ ...edit, pcts: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Aging (hari)"><input className="input" inputMode="numeric" value={edit.agingDays} onChange={(e) => setEdit({ ...edit, agingDays: e.target.value })} /></Field>
              <Field label="Jenis hari"><select className="input" value={edit.agingType} onChange={(e) => setEdit({ ...edit, agingType: e.target.value as '' | 'CALENDAR' | 'WORKING' })}><option value="">—</option><option value="CALENDAR">Kalender</option><option value="WORKING">Kerja</option></select></Field>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

export function HolidaySection() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['holidays'], queryFn: () => api<{ id: string; date: string; name: string }[]>('/holidays') });
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const add = useMutation({ mutationFn: () => api('/holidays', { method: 'POST', json: { date, name } }), onSuccess: () => { setDate(''); setName(''); void qc.invalidateQueries({ queryKey: ['holidays'] }); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/holidays/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }) });
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-semibold">Hari libur (untuk jatuh tempo hari kerja)</h2>
      <ul className="divide-y text-sm">
        {q.data?.map((h) => (
          <li key={h.id} className="flex items-center gap-2 py-1.5">
            <span className="w-40">{formatTanggal(h.date)}</span><span className="flex-1">{h.name}</span>
            {can('ADMIN') && <button className="btn-ghost p-1 text-red-600" aria-label={`Hapus ${h.name}`} onClick={() => del.mutate(h.id)}><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}
        {!q.data?.length && <li className="py-2 text-xs text-slate-500">Belum ada hari libur.</li>}
      </ul>
      {can('ADMIN') && (
        <div className="flex flex-wrap gap-2">
          <input type="date" className="input w-44" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Tanggal libur" />
          <input className="input flex-1" placeholder="Nama hari libur" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nama hari libur" />
          <button className="btn-primary" disabled={!date || name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}><Plus className="h-4 w-4" /> Tambah</button>
        </div>
      )}
      <ErrorBox error={add.error ? errorMessage(add.error) : null} />
    </section>
  );
}

export function ApiKeySection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => api<{ id: string; name: string; prefix: string; createdBy: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[]>('/api-keys') });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const add = useMutation({ mutationFn: () => api<{ key: string }>('/api-keys', { method: 'POST', json: { name } }), onSuccess: (r) => { setCreated(r.key); setName(''); void qc.invalidateQueries({ queryKey: ['api-keys'] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api-keys/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }) });
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-semibold">API key bot (Telegram / n8n)</h2>
      <p className="text-xs text-slate-500">
        Webhook: <code>POST /api/webhooks/expenses</code> dengan header <code>X-API-Key</code>, body {'{ cluster, kategori, nominal, tanggal, keterangan?, externalId?, fotoBase64? }'} atau multipart dengan file <code>foto</code>.
        Hasil selalu "Perlu verifikasi" Finance.
      </p>
      <ul className="divide-y text-sm">
        {q.data?.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="font-medium">{k.name}</span>
            <code className="text-xs text-slate-500">ibk_{k.prefix}_…</code>
            <span className="text-xs text-slate-500">dipakai: {k.lastUsedAt ? formatTanggal(k.lastUsedAt) : 'belum'}</span>
            {k.revokedAt ? <span className="text-xs text-red-600">dicabut</span> : <button className="ml-auto text-xs text-red-600 underline" onClick={() => confirm('Cabut API key ini?') && revoke.mutate(k.id)}>Cabut</button>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="input" placeholder="Nama (mis. Bot Telegram)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nama API key" />
        <button className="btn-primary" disabled={name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}><Plus className="h-4 w-4" /> Buat</button>
      </div>
      <Modal open={!!created} title="API key baru" onClose={() => setCreated(null)} footer={<button className="btn-primary" onClick={() => setCreated(null)}>Sudah disimpan</button>}>
        <p className="text-sm">Salin sekarang — key ini <b>tidak akan ditampilkan lagi</b>.</p>
        <div className="flex gap-2"><code className="flex-1 break-all rounded bg-slate-100 p-2 text-xs" data-testid="new-api-key">{created}</code><button className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(created ?? '')} aria-label="Salin"><Copy className="h-4 w-4" /></button></div>
      </Modal>
    </section>
  );
}
