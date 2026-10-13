import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BULAN } from '@indotek/shared';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { ErrorBox, Money, PageHeader, Spinner, cx } from '../components/ui';
import { formatTanggal } from '../lib/format';

interface LedgerRow { id: string; date: string; description: string; project: string | null; projectLabel: string | null; cashAccount: string | null; accountName: string | null; cashIn: string; cashOut: string }
interface Recon { rows: { month: string; cashOut: string; cashIn: string; expense: string; selisih: string; ledgerRows: number; expenseRows: number }[]; total: { cashOut: string; cashIn: string; expense: string; selisih: string } }

const monthLabel = (m: string) => (m === 'TANPA_TANGGAL' ? 'Tanpa tanggal' : `${BULAN[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`);

/** Buku kas (referensi, tidak dihitung sebagai realisasi) + rekonsiliasi sederhana per bulan. */
export function BukuKasPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') });
  const [projectId, setProjectId] = useState('');
  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);
  const recon = useQuery({ queryKey: ['reconciliation', projectId], queryFn: () => api<Recon>(`/projects/${projectId}/reconciliation`), enabled: !!projectId });
  const ledger = useQuery({ queryKey: ['cash-ledger', projectId], queryFn: () => api<LedgerRow[]>(`/import/cash-ledger?projectId=${projectId}`), enabled: !!projectId });

  return (
    <div>
      <PageHeader title="Buku Kas & Rekonsiliasi" subtitle="Buku kas hasil import (sheet TELCO - OPS) hanya referensi — realisasi dihitung dari expense terverifikasi." />
      <select className="input mb-4 sm:w-64" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
        {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.client.name}</option>)}
      </select>
      <section className="card mb-4 overflow-x-auto">
        <h2 className="border-b px-4 py-3 font-semibold">Rekonsiliasi per bulan</h2>
        {recon.isLoading ? <Spinner /> : recon.error ? <ErrorBox error={recon.error} /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Bulan</th><th className="th num">Cash out (buku kas)</th><th className="th num">Expense terverifikasi</th><th className="th num">Selisih</th><th className="th num hidden sm:table-cell">Baris kas / expense</th></tr></thead>
            <tbody>
              {recon.data?.rows.map((r) => (
                <tr key={r.month} className="border-t">
                  <td className="td">{monthLabel(r.month)}</td>
                  <td className="td num"><Money value={r.cashOut} plain /></td>
                  <td className="td num"><Money value={r.expense} plain /></td>
                  <td className={cx('td num font-semibold', Number(r.selisih) !== 0 && 'text-amber-700')}><Money value={r.selisih} plain /></td>
                  <td className="td num hidden text-slate-500 sm:table-cell">{r.ledgerRows} / {r.expenseRows}</td>
                </tr>
              ))}
              {recon.data && (
                <tr className="border-t bg-slate-50 font-bold"><td className="td">TOTAL</td><td className="td num"><Money value={recon.data.total.cashOut} plain /></td><td className="td num"><Money value={recon.data.total.expense} plain /></td><td className="td num"><Money value={recon.data.total.selisih} plain /></td><td className="td hidden sm:table-cell" /></tr>
              )}
            </tbody>
          </table>
        )}
        <p className="px-4 py-2 text-xs text-slate-500">Selisih = cash out buku kas − expense terverifikasi (tanpa pencocokan otomatis per transaksi).</p>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="border-b px-4 py-3 font-semibold">Transaksi buku kas</h2>
        {ledger.isLoading ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Tanggal</th><th className="th">Keterangan</th><th className="th hidden md:table-cell">Kas/Bank</th><th className="th num">Masuk</th><th className="th num">Keluar</th></tr></thead>
            <tbody>
              {ledger.data?.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="td">{formatTanggal(r.date)}</td>
                  <td className="td max-w-[420px] whitespace-normal">{r.description}{r.accountName && <div className="text-[11px] text-slate-500">{r.accountName}</div>}</td>
                  <td className="td hidden md:table-cell">{r.cashAccount ?? '—'}</td>
                  <td className="td num">{Number(r.cashIn) ? <Money value={r.cashIn} plain /> : ''}</td>
                  <td className="td num">{Number(r.cashOut) ? <Money value={r.cashOut} plain /> : ''}</td>
                </tr>
              ))}
              {!ledger.data?.length && <tr><td colSpan={5} className="td text-center text-slate-500">Belum ada data — import lewat menu Import Excel → Buku Kas.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
