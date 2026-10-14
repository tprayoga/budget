import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_LABEL } from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import type { Client, Project } from '../api/types';
import { REFERENCE_VALUE_TYPES, REFERENCE_VALUE_TYPE_LABEL } from '@indotek/shared';
import { pctInputToRatio, ratioToPctInput } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { ErrorBox, Field, Modal, PageHeader, Spinner } from '../components/ui';

interface UserRow { id: string; name: string; email: string; role: keyof typeof ROLE_LABEL; jabatan: string | null; memberships: { projectId: string }[] }

export function MasterPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api<Client[]>('/clients') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users'), enabled: can('ADMIN') });
  const [clientName, setClientName] = useState('');
  const [pOpen, setPOpen] = useState(false);
  const [pForm, setPForm] = useState({ code: '', name: '', clientId: '', year: String(new Date().getFullYear()) });

  const addClient = useMutation({
    mutationFn: () => api('/clients', { method: 'POST', json: { name: clientName } }),
    onSuccess: async () => { setClientName(''); await qc.invalidateQueries({ queryKey: ['clients'] }); },
  });
  const addProject = useMutation({
    mutationFn: () => api('/projects', { method: 'POST', json: { ...pForm, code: pForm.code.toUpperCase(), year: Number(pForm.year) } }),
    onSuccess: async () => { setPOpen(false); await qc.invalidateQueries({ queryKey: ['projects'] }); await qc.invalidateQueries({ queryKey: ['rekap'] }); },
  });
  const setMembers = useMutation({
    mutationFn: ({ projectId, userIds }: { projectId: string; userIds: string[] }) => api(`/projects/${projectId}/members`, { method: 'PUT', json: { userIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  if (clients.isLoading || projects.isLoading) return <Spinner />;
  const investors = (users.data ?? []).filter((u) => u.role === 'INVESTOR');

  return (
    <div className="space-y-6">
      <PageHeader title="Data Master" subtitle="Pemberi kerja, project, dan akses investor per project" />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card min-w-0 p-4">
          <h2 className="mb-3 font-semibold">Pemberi kerja</h2>
          <ul className="mb-3 divide-y text-sm">{clients.data?.map((c) => <ClientPpnRow key={c.id} client={c} />)}</ul>
          <div className="flex gap-2">
            <input className="input" placeholder="Nama pemberi kerja baru" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            <button className="btn-primary" disabled={clientName.trim().length < 2 || addClient.isPending} onClick={() => addClient.mutate()}><Plus className="h-4 w-4" /></button>
          </div>
          <div className="mt-2"><ErrorBox error={addClient.error ? errorMessage(addClient.error) : null} /></div>
        </section>
        <section className="card min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Project</h2>
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setPOpen(true)}><Plus className="h-3.5 w-3.5" /> Project</button>
          </div>
          <ul className="divide-y text-sm">
            {projects.data?.map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <Link className="text-brand hover:underline" to={`/projects/${p.id}`}>{p.code} — {p.name}</Link>
                <span className="text-slate-500">{p.client.name} · {p._count?.clusters ?? 0} cluster</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {can('ADMIN') && (
        <section className="card overflow-x-auto p-4">
          <h2 className="mb-1 font-semibold">Akses investor per project</h2>
          <p className="mb-3 text-xs text-slate-500">Investor hanya dapat melihat & menyetujui pengajuan pada project yang dicentang. Role lain melihat semua project.</p>
          {investors.length === 0 ? <p className="text-sm text-slate-500">Belum ada user investor.</p> : (
            <table className="text-sm">
              <thead><tr><th className="th">Investor</th>{projects.data?.map((p) => <th key={p.id} className="th text-center">{p.code}</th>)}</tr></thead>
              <tbody>
                {investors.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="td">{u.name}<div className="text-xs text-slate-500">{u.email}</div></td>
                    {projects.data?.map((p) => {
                      const member = u.memberships.some((m) => m.projectId === p.id);
                      return (
                        <td key={p.id} className="td text-center">
                          <input
                            type="checkbox"
                            checked={member}
                            aria-label={`Akses ${u.name} ke ${p.code}`}
                            onChange={() => {
                              const current = (users.data ?? []).filter((x) => x.memberships.some((m) => m.projectId === p.id)).map((x) => x.id);
                              const next = member ? current.filter((x) => x !== u.id) : [...current, u.id];
                              setMembers.mutate({ projectId: p.id, userIds: next });
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ErrorBox error={setMembers.error ? errorMessage(setMembers.error) : null} />
        </section>
      )}

      <Modal
        open={pOpen}
        title="Project baru"
        onClose={() => setPOpen(false)}
        footer={<><button className="btn-secondary" onClick={() => setPOpen(false)}>Batal</button><button className="btn-primary" disabled={addProject.isPending} onClick={() => addProject.mutate()}>Simpan</button></>}
      >
        <ErrorBox error={addProject.error ? errorMessage(addProject.error) : null} />
        <Field label="Kode" hint="Huruf kapital, dipakai di nomor FPD & nama sheet Excel (mis. ADW)."><input className="input uppercase" value={pForm.code} onChange={(e) => setPForm({ ...pForm, code: e.target.value })} /></Field>
        <Field label="Nama"><input className="input" value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} /></Field>
        <Field label="Pemberi kerja">
          <select className="input" value={pForm.clientId} onChange={(e) => setPForm({ ...pForm, clientId: e.target.value })}>
            <option value="">Pilih…</option>
            {clients.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Tahun"><input className="input" inputMode="numeric" value={pForm.year} onChange={(e) => setPForm({ ...pForm, year: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}

/** Nama client + PPN termin (override Setting global; ADMIN). Berlaku untuk termin yang dibuat setelahnya. */
function ClientPpnRow({ client }: { client: Client }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(client.ppnRate != null ? ratioToPctInput(client.ppnRate) : '');
  const [reason, setReason] = useState('');
  const saveRef = useMutation({
    mutationFn: (referenceValueType: string) => api(`/clients/${client.id}/reference-value-type`, { method: 'PATCH', json: { referenceValueType } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
  const save = useMutation({
    mutationFn: () => api(`/clients/${client.id}/ppn`, { method: 'PATCH', json: { ppnRate: v.trim() === '' ? null : pctInputToRatio(v), reason: reason || null } }),
    onSuccess: async () => {
      setEdit(false);
      await qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
  return (
    <li className="py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span>{client.name}</span>
        <span className="text-xs text-slate-500">
          PPN termin: {client.ppnRate != null ? `${ratioToPctInput(client.ppnRate)}%` : 'ikut global'}
          {can('ADMIN') && !edit && <button className="ml-2 text-brand hover:underline" onClick={() => setEdit(true)}>ubah</button>}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-end gap-2 text-xs text-slate-500">
        Nilai referensi RAB:
        {can('ADMIN') ? (
          <select
            className="input w-auto py-0.5 text-xs"
            value={client.referenceValueType ?? 'INVOICE_TOTAL'}
            disabled={saveRef.isPending}
            onChange={(e) => saveRef.mutate(e.target.value)}
            aria-label={`Nilai referensi ${client.name}`}
          >
            {REFERENCE_VALUE_TYPES.map((t) => <option key={t} value={t}>{REFERENCE_VALUE_TYPE_LABEL[t]}</option>)}
          </select>
        ) : (
          <span>{REFERENCE_VALUE_TYPE_LABEL[client.referenceValueType ?? 'INVOICE_TOTAL']}</span>
        )}
      </div>
      {edit && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input className="input w-24 py-1" inputMode="decimal" placeholder="global" value={v} onChange={(e) => setV(e.target.value)} aria-label={`PPN ${client.name}`} />
          <input className="input w-48 py-1" placeholder="alasan" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn-primary px-2 py-1 text-xs" disabled={save.isPending} onClick={() => save.mutate()}>Simpan</button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(false)}>Batal</button>
          <span className="w-full text-[11px] text-slate-500">Kosong = ikut global. Termin yang sudah ada tidak berubah.</span>
          <ErrorBox error={save.error ? errorMessage(save.error) : null} />
        </div>
      )}
    </li>
  );
}
