import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EXPENSE_CATEGORY_LABEL, formatRupiah, todayJakartaIso, type ExpenseCategory } from '@indotek/shared';
import { api, errorMessage } from '../api/client';
import type { Expense } from '../api/types';
import { ErrorBox, cx } from '../components/ui';
import { compressImage } from '../lib/image';
import { rpInputToValue } from '../lib/format';

/** Kategori yang paling sering diinput dari lapangan (tombol besar). */
const QUICK: ExpenseCategory[] = ['OPS', 'PJD', 'TICKET', 'HOMEBASE', 'MOTOR_MOBIL', 'MATERIAL_PEMBELIAN', 'PERMIT', 'SUBCON_JASA'];
const RECENT_KEY = 'indotek.quick.clusters';

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...loadRecent().filter((x) => x !== id)].slice(0, 5)));
  } catch {
    /* storage tidak tersedia */
  }
}

/** Input realisasi satu layar untuk HP: cluster, kategori, nominal, tanggal, foto nota (dikompres di browser). */
export function QuickExpensePage() {
  const qc = useQueryClient();
  const clusters = useQuery({ queryKey: ['clusters', 'all'], queryFn: () => api<{ id: string; name: string; status: string; project: { code: string } }[]>('/clusters') });
  const [search, setSearch] = useState('');
  const [clusterId, setClusterId] = useState('');
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayJakartaIso());
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [done, setDone] = useState<Expense | null>(null);
  const recent = useMemo(loadRecent, [done]);

  const list = (clusters.data ?? [])
    .filter((c) => c.status !== 'CANCELLED')
    .filter((c) => (search ? c.name.toLowerCase().includes(search.toLowerCase()) : recent.includes(c.id)))
    .slice(0, 8);
  const selected = clusters.data?.find((c) => c.id === clusterId);
  const amt = rpInputToValue(amount);

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set('clusterId', clusterId);
      fd.set('category', category!);
      fd.set('amount', amt!);
      fd.set('date', date);
      fd.set('description', note.trim() || `${EXPENSE_CATEGORY_LABEL[category!]} lapangan`);
      fd.set('source', 'MOBILE');
      if (file) fd.set('file', await compressImage(file));
      return api<Expense>('/expenses', { method: 'POST', body: fd });
    },
    onSuccess: (e) => {
      pushRecent(clusterId);
      setDone(e);
      setAmount('');
      setNote('');
      setFile(null);
      void qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });

  if (done) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-8 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
        <div className="text-lg font-bold">Tersimpan</div>
        <p className="text-sm text-slate-600">
          {EXPENSE_CATEGORY_LABEL[done.category]} {formatRupiah(done.amount)} — {done.cluster?.name}
          <br />
          {done.status === 'PERLU_VERIFIKASI' ? 'Menunggu verifikasi Finance sebelum dihitung.' : 'Langsung terverifikasi.'}
        </p>
        <button className="btn-primary w-full py-3" onClick={() => setDone(null)}>Input lagi</button>
        <Link to="/realisasi" className="btn-ghost w-full">Lihat daftar realisasi</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold">Input realisasi cepat</h1>
      <ErrorBox error={save.error ? errorMessage(save.error) : null} />
      <section>
        <div className="label">Cluster</div>
        {selected ? (
          <button className="input flex items-center justify-between text-left" onClick={() => setClusterId('')}>
            <span className="truncate font-medium">{selected.name}</span><span className="text-xs text-slate-500">{selected.project.code} · ganti</span>
          </button>
        ) : (
          <>
            <input className="input" placeholder="Cari cluster…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari cluster" />
            <div className="mt-1 divide-y rounded-lg border bg-white">
              {!search && !list.length && <div className="px-3 py-2 text-xs text-slate-500">Ketik nama cluster…</div>}
              {list.map((c) => (
                <button key={c.id} className="block w-full px-3 py-2.5 text-left text-sm active:bg-slate-50" onClick={() => setClusterId(c.id)}>
                  {c.name} <span className="text-xs text-slate-500">{c.project.code}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
      <section>
        <div className="label">Kategori</div>
        <div className="grid grid-cols-2 gap-2">
          {QUICK.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={cx('rounded-xl border px-3 py-3 text-sm font-medium', category === c ? 'border-brand bg-brand text-white' : 'bg-white')}>
              {EXPENSE_CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Nominal (Rp)</span><input className="input py-3 text-right text-lg font-bold" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Nominal" /></label>
        <label className="block"><span className="label">Tanggal</span><input type="date" className="input py-3" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </section>
      <input className="input" placeholder="Keterangan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Keterangan" />
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-600">
        <Camera className="h-5 w-5" /> {file ? file.name : 'Foto nota (kamera)'}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Foto nota" />
      </label>
      <button className="btn-primary w-full py-3 text-base" disabled={!clusterId || !category || !amt || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Menyimpan…' : 'Simpan'}
      </button>
    </div>
  );
}
