import { ATTACHMENT_LABEL, FORM_ATTACHMENT_KINDS, type AttachmentKind } from '@indotek/shared';
import { Check, Paperclip } from 'lucide-react';
import { download } from '../api/client';
import type { FrDetail, FrLine, FrTotals } from '../api/types';
import { formatPersen, formatTanggal } from '../lib/format';
import { Money, Pct, cx } from './ui';

export function attachmentLabel(kind: AttachmentKind, fr: Pick<FrDetail, 'project' | 'client'>) {
  if (kind === 'PROYEKSI_BUDGET') return `Proyeksi budget proyek (sheet ${fr.project.code})`;
  if (kind === 'PO_SPK') return `PO / SPK dengan ${fr.client.name}`;
  return ATTACHMENT_LABEL[kind];
}

function LineRow({ l, i }: { l: FrLine; i: number }) {
  return (
    <tr className={cx('border-t', l.overBudget && 'bg-red-50')}>
      <td className="td text-center text-slate-400">{i + 1}</td>
      <td className="td whitespace-normal">
        {l.label}
        {l.penyesuaianPembulatan && <span className="ml-1 text-[10px] text-amber-700" title="Termin pelunasan: disesuaikan ke sisa budget (pembulatan)">≈ pelunasan</span>}
      </td>
      <td className="td num hidden lg:table-cell"><Pct value={l.pctNilaiProyek} /></td>
      <td className="td num"><Money value={l.budgetAmount} plain /></td>
      <td className="td num"><Pct value={l.pctCair} decimals={0} /></td>
      <td className="td num font-semibold"><Money value={l.diajukan} plain /></td>
      <td className="td num hidden sm:table-cell"><Money value={l.sudahDicairkanSebelum} plain /></td>
      <td className="td num hidden sm:table-cell"><Money value={l.sisaBudget} plain /></td>
      <td className="td hidden whitespace-normal text-xs text-slate-500 xl:table-cell">{l.keterangan}</td>
    </tr>
  );
}

function TotalRow({ label, t, strong }: { label: string; t: FrTotals; strong?: boolean }) {
  return (
    <tr className={cx('border-t font-semibold', strong ? 'bg-accent' : 'bg-slate-50')}>
      <td className="td" />
      <td className="td">{label}</td>
      <td className="td num hidden lg:table-cell"><Pct value={t.pctNilaiProyek} /></td>
      <td className="td num"><Money value={t.budgetAmount} plain /></td>
      <td className="td" />
      <td className="td num"><Money value={t.diajukan} plain /></td>
      <td className="td num hidden sm:table-cell"><Money value={t.sudahDicairkanSebelum} plain /></td>
      <td className="td num hidden sm:table-cell"><Money value={t.sisaBudget} plain /></td>
      <td className="td hidden xl:table-cell" />
    </tr>
  );
}

/** Tampilan Form Pengajuan Dana (meniru layout sheet Form & PDF). */
export function FrSheet({ fr }: { fr: FrDetail }) {
  const a = fr.lines.filter((l) => l.section === 'A');
  const b = fr.lines.filter((l) => l.section === 'B');
  const anySedang = fr.lines.some((l) => Number(l.sedangDiproses) !== 0);
  const checked = new Set(fr.attachments.filter((x) => x.checked || x.hasFile).map((x) => x.kind));

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="bg-accent px-4 py-3 text-center">
          <div className="text-lg font-black tracking-wide text-brand">FORM PENGAJUAN DANA</div>
          <div className="text-xs text-slate-700">PT Indotek Buana Karya — Modal Kerja Proyek {fr.project.code}</div>
        </div>
        <dl className="grid gap-x-6 gap-y-1 p-4 text-sm sm:grid-cols-2">
          {[
            ['No. Pengajuan', <b key="n">{fr.label}</b>],
            ['Diajukan oleh', fr.diajukanOleh.name],
            ['Tanggal', formatTanggal(fr.tanggal)],
            ['Jabatan', fr.diajukanOleh.jabatan ?? '—'],
            ['Nama proyek', <b key="c">{fr.cluster.name}</b>],
            ['Diajukan kepada', fr.diajukanKepada],
            ['Pemberi kerja', fr.client.name],
            ['Termin pencairan ke-', fr.terminKe],
            ['Nilai proyek', <Money key="np" value={fr.snapshot.nilaiProyek} className="font-semibold" />],
            ['Periode penggunaan', fr.periode ?? '—'],
          ].map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-3 border-b border-dashed border-slate-100 py-1">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card overflow-x-auto">
        <div className="bg-brand px-4 py-2 text-sm font-semibold text-white">RINCIAN KEBUTUHAN DANA</div>
        <table className="w-full text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="th">No</th><th className="th">Pos anggaran</th><th className="th num hidden lg:table-cell">% Nilai proyek</th>
              <th className="th num">Budget</th><th className="th num">% Cair</th><th className="th num">Diajukan</th>
              <th className="th num hidden sm:table-cell">Sudah cair sblm</th><th className="th num hidden sm:table-cell">Sisa budget</th>
              <th className="th hidden xl:table-cell">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-slate-100 text-xs font-bold"><td className="td">A</td><td className="td" colSpan={8}>SUBCON, PERMIT &amp; PAJAK</td></tr>
            {a.map((l, i) => <LineRow key={l.budgetCode} l={l} i={i} />)}
            <TotalRow label="Subtotal A" t={fr.subtotalA} />
            <tr className="bg-slate-100 text-xs font-bold"><td className="td">B</td><td className="td" colSpan={8}>COST PROJECT</td></tr>
            {b.map((l, i) => <LineRow key={l.budgetCode} l={l} i={i} />)}
            <TotalRow label="Subtotal B" t={fr.subtotalB} />
            <TotalRow label="TOTAL PENGAJUAN" t={fr.total} strong />
          </tbody>
        </table>
        {anySedang && (
          <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Ada pengajuan lain untuk cluster ini yang sedang diproses: <b><Money value={fr.total.sedangDiproses} /></b>. Nilai ini ikut dihitung saat validasi sisa budget.
          </p>
        )}
        {fr.overBudgetCodes.length > 0 && (
          <p className="border-t bg-red-50 px-4 py-2 text-xs text-red-700">
            Melebihi sisa budget pada: {fr.lines.filter((l) => l.overBudget).map((l) => l.label).join(', ')}.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4 text-sm">
          <div className="mb-2 font-semibold">Informasi pendukung <span className="font-normal text-slate-500">(tidak termasuk pengajuan)</span></div>
          <dl className="space-y-1">
            <div className="flex justify-between"><dt>Bunga dana investor ({formatPersen(fr.snapshot.interestRate, 0)} × dana investor)</dt><dd><Money value={fr.snapshot.infoBunga} /></dd></div>
            <div className="flex justify-between"><dt>Cadangan budget / retensi</dt><dd><Money value={fr.snapshot.infoRetensi} /></dd></div>
            <div className="flex justify-between"><dt>Proyeksi profit cluster</dt><dd><Money value={fr.snapshot.infoProfit} /></dd></div>
            <div className="flex justify-between"><dt>Margin profit</dt><dd><Pct value={fr.snapshot.infoMargin} /></dd></div>
          </dl>
          <div className="mt-3 rounded bg-slate-50 p-2 text-xs italic">Terbilang: <b>{fr.terbilang}</b></div>
        </div>
        <div className="card space-y-3 p-4 text-sm">
          <div>
            <div className="font-semibold">Justifikasi</div>
            <p className="text-slate-700">{fr.justifikasi}</p>
          </div>
          <div>
            <div className="font-semibold">Rekening tujuan</div>
            <p className="text-slate-700">{fr.rekeningBank ?? '—'} · {fr.rekeningNo ?? '—'} · a.n. {fr.rekeningNama ?? '—'}</p>
          </div>
          <div>
            <div className="font-semibold">Lampiran</div>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2">
              {FORM_ATTACHMENT_KINDS.map((k) => (
                <li key={k} className="flex items-center gap-1.5 text-xs">
                  <span className={cx('grid h-4 w-4 place-items-center rounded border', checked.has(k) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300')}>
                    {checked.has(k) && <Check className="h-3 w-3" />}
                  </span>
                  {attachmentLabel(k, fr)}
                </li>
              ))}
            </ul>
            <ul className="mt-2 space-y-0.5">
              {fr.attachments.filter((x) => x.hasFile).map((x) => (
                <li key={x.id}>
                  <button className="inline-flex items-center gap-1 text-xs text-brand hover:underline" onClick={() => void download(`/fund-requests/${fr.id}/attachments/${x.id}/file`, x.fileName ?? 'lampiran', true)}>
                    <Paperclip className="h-3 w-3" /> {x.fileName} <span className="text-slate-400">({ATTACHMENT_LABEL[x.kind]})</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
