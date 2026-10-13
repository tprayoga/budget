import { Link } from 'react-router-dom';
import type { FrListItem } from '../api/types';
import { formatTanggal } from '../lib/format';
import { Money, StatusBadge } from './ui';

/** Daftar pengajuan: tabel di desktop, kartu di HP. */
export function FrTable({ items, empty }: { items: FrListItem[]; empty: string }) {
  if (!items.length) return <p className="card px-4 py-10 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <>
      <div className="space-y-2 md:hidden">
        {items.map((f) => (
          <Link key={f.id} to={`/pengajuan/${f.id}`} className="card block p-3 active:bg-slate-50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-brand">{f.label}</div>
                <div className="truncate text-sm">{f.cluster.name}</div>
                <div className="text-xs text-slate-500">{f.project.code} · termin {f.terminKe} · {formatTanggal(f.tanggal)}</div>
              </div>
              <StatusBadge status={f.status} />
            </div>
            <div className="mt-2 text-right text-base font-bold"><Money value={f.totalDiajukan} /></div>
          </Link>
        ))}
      </div>
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Nomor</th><th className="th">Tanggal</th><th className="th">Project</th><th className="th">Cluster</th>
              <th className="th">Termin</th><th className="th">Status</th><th className="th num">Total diajukan</th><th className="th">Pemohon</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.id} className="border-t hover:bg-slate-50">
                <td className="td"><Link className="font-medium text-brand hover:underline" to={`/pengajuan/${f.id}`}>{f.label}</Link></td>
                <td className="td">{formatTanggal(f.tanggal)}</td>
                <td className="td">{f.project.code}</td>
                <td className="td max-w-[280px] truncate" title={f.cluster.name}>{f.cluster.name}</td>
                <td className="td">{f.terminKe}</td>
                <td className="td"><StatusBadge status={f.status} /></td>
                <td className="td num"><Money value={f.totalDiajukan} /></td>
                <td className="td">{f.diajukanOleh.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
