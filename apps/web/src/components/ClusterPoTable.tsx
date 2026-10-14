import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PO_KINDS, PO_KIND_LABEL, sum, type PoKind } from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import type { ClusterPo } from '../api/types';
import { ErrorBox, Field, Modal, Money, cx } from './ui';
import { formatAngka, formatTanggal, rpInputToValue } from '../lib/format';

type Draft = { id: string | null; kind: PoKind; poNumber: string; poDate: string; amount: string; passThroughCost: string; note: string };

const empty: Draft = { id: null, kind: 'ADDWORK', poNumber: '', poDate: '', amount: '', passThroughCost: '0', note: '' };
const toInput = (v: string) => formatAngka(v, 2).replace(/,00$/, '');

/** Tabel PO cluster: nilai PO implementasi / permit & biaya permit cluster diturunkan dari sini. */
export function ClusterPoTable({ clusterId, pos, editable }: { clusterId: string; pos: ClusterPo[]; editable: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = async () => {
    for (const key of [['cluster', clusterId], ['client-payments', clusterId], ['rekap'], ['project-budget']]) await qc.invalidateQueries({ queryKey: key });
  };
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        poNumber: d.poNumber.trim() || null,
        poDate: d.poDate || null,
        amount: rpInputToValue(d.amount)!,
        passThroughCost: rpInputToValue(d.passThroughCost || '0')!,
        note: d.note.trim() || null,
      };
      return d.id
        ? api(`/clusters/pos/${d.id}`, { method: 'PATCH', json: body })
        : api(`/clusters/${clusterId}/pos`, { method: 'POST', json: { ...body, kind: d.kind } });
    },
    onSuccess: async () => {
      setDraft(null);
      await invalidate();
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/clusters/pos/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const submit = () => {
    if (!draft) return;
    const amount = rpInputToValue(draft.amount);
    const cost = rpInputToValue(draft.passThroughCost || '0');
    if (amount === null || cost === null) return setFormError('Nilai tidak valid');
    if (draft.kind === 'DEDUCTION' && Number(amount) > 0) return setFormError('Deduction harus bernilai negatif (mis. -750.000)');
    if (draft.kind !== 'DEDUCTION' && Number(amount) < 0) return setFormError('Nilai PO tidak boleh negatif');
    if (Number(cost) < 0) return setFormError('Biaya pass-through tidak boleh negatif');
    setFormError(null);
    save.mutate(draft);
  };

  const of = (kinds: PoKind[]) => sum(pos.filter((p) => kinds.includes(p.kind)).map((p) => p.amount)).toString();
  const totals = [
    { label: 'Nilai PO Implementasi', hint: 'Implementasi + Addwork + Deduction', value: of(['IMPLEMENTASI', 'ADDWORK', 'DEDUCTION']) },
    { label: 'Nilai PO Permit', hint: 'Permit + SND; margin permit hanya Permit', value: of(['PERMIT', 'SND']) },
    { label: 'Biaya permit (pass-through)', hint: 'Σ biaya pass-through', value: sum(pos.map((p) => p.passThroughCost)).toString() },
  ];

  return (
    <section className="card overflow-hidden" aria-label="PO cluster">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="font-semibold">PO cluster</h2>
          <p className="text-xs text-slate-500">Nilai PO & biaya permit di budget dihitung dari tabel ini. Setiap perubahan tercatat di audit log.</p>
        </div>
        {editable && (
          <button className="btn-secondary" onClick={() => { setFormError(null); setDraft({ ...empty }); }}>
            <Plus className="h-4 w-4" /> Tambah PO
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Jenis</th><th className="th">No. PO</th><th className="th">Tanggal</th>
              <th className="th num">Nilai</th><th className="th num">Biaya pass-through</th><th className="th">Catatan</th>
              {editable && <th className="th" />}
            </tr>
          </thead>
          <tbody>
            {pos.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="td"><span className={cx('rounded px-1.5 py-0.5 text-xs font-semibold', p.kind === 'DEDUCTION' ? 'bg-red-50 text-red-700' : p.kind === 'IMPLEMENTASI' ? 'bg-brand-100 text-brand' : 'bg-slate-100 text-slate-700')}>{PO_KIND_LABEL[p.kind]}{p.subKind ? ` · ${p.subKind === 'SUBFEEDER' ? 'Subfeeder' : 'Cluster'}` : ''}</span></td>
                <td className="td">{p.poNumber ?? <span className="text-slate-400">—</span>}</td>
                <td className="td">{p.poDate ? formatTanggal(p.poDate) : <span className="text-slate-400">—</span>}</td>
                <td className="td num"><Money value={p.amount} /></td>
                <td className="td num">{Number(p.passThroughCost) ? <Money value={p.passThroughCost} /> : <span className="text-slate-400">—</span>}</td>
                <td className="td max-w-xs whitespace-normal text-xs text-slate-600">{p.note}</td>
                {editable && (
                  <td className="td whitespace-nowrap text-right">
                    <button
                      className="btn-ghost px-1.5"
                      aria-label={`Ubah PO ${PO_KIND_LABEL[p.kind]} ${p.poNumber ?? ''}`}
                      onClick={() => {
                        setFormError(null);
                        setDraft({ id: p.id, kind: p.kind, poNumber: p.poNumber ?? '', poDate: p.poDate ?? '', amount: toInput(p.amount), passThroughCost: toInput(p.passThroughCost), note: p.note ?? '' });
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="btn-ghost px-1.5 text-red-600"
                      aria-label={`Hapus PO ${PO_KIND_LABEL[p.kind]} ${p.poNumber ?? ''}`}
                      onClick={() => confirm(`Hapus PO ${PO_KIND_LABEL[p.kind]} ${p.poNumber ?? ''}? Termin yang belum ditagih ikut terhapus.`) && del.mutate(p.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-slate-50 text-xs">
            {totals.map((t) => (
              <tr key={t.label}>
                <td className="td font-semibold" colSpan={3}>{t.label} <span className="font-normal text-slate-500">({t.hint})</span></td>
                <td className="td num font-semibold" colSpan={2}><Money value={t.value} /></td>
                <td className="td" colSpan={editable ? 2 : 1} />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <ErrorBox error={del.error ? errorMessage(del.error) : null} />

      <Modal
        open={!!draft}
        title={draft?.id ? 'Ubah PO' : 'Tambah PO'}
        onClose={() => setDraft(null)}
        footer={<><button className="btn-secondary" onClick={() => setDraft(null)}>Batal</button><button className="btn-primary" disabled={save.isPending} onClick={submit}>{save.isPending ? 'Menyimpan…' : 'Simpan'}</button></>}
      >
        {draft && (
          <div className="space-y-3">
            <ErrorBox error={formError ?? (save.error ? errorMessage(save.error) : null)} />
            <Field label="Jenis PO">
              <select className="input" value={draft.kind} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PoKind })}>
                {PO_KINDS.map((k) => <option key={k} value={k}>{PO_KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="No. PO"><input className="input" value={draft.poNumber} onChange={(e) => setDraft({ ...draft, poNumber: e.target.value })} /></Field>
              <Field label="Tanggal PO"><input type="date" className="input" value={draft.poDate} onChange={(e) => setDraft({ ...draft, poDate: e.target.value })} /></Field>
              <Field label="Nilai (Rp)" hint={draft.kind === 'DEDUCTION' ? 'Deduction ditulis negatif, mis. -750.000' : undefined}>
                <input className="input text-right" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} aria-label="Nilai PO" />
              </Field>
              <Field label="Biaya pass-through (Rp)" hint="Biaya yang diteruskan (mis. permit). Menjadi biaya permit budget.">
                <input className="input text-right" inputMode="decimal" value={draft.passThroughCost} onChange={(e) => setDraft({ ...draft, passThroughCost: e.target.value })} aria-label="Biaya pass-through" />
              </Field>
            </div>
            <Field label="Catatan"><input className="input" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field>
            {(draft.kind === 'ADDWORK' || draft.kind === 'DEDUCTION') && (
              <p className="text-xs text-slate-500">Addwork/deduction tidak punya termin sendiri — mengoreksi termin 1 PO implementasi lewat "Hitung ulang termin" (FINANCE) di tab Termin Klien.</p>
            )}
            {!draft.id && draft.kind === 'SND' && <p className="text-xs text-slate-500">Termin klien 1 × 100% dibuat otomatis untuk PO SND (tanggal invoice diisi FINANCE).</p>}
          </div>
        )}
      </Modal>
    </section>
  );
}
