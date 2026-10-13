import {
  ATTACHMENT_LABEL,
  FORM_ATTACHMENT_KINDS,
  formatAngka,
  formatPersen,
  formatTanggal,
  FR_STATUS_LABEL,
  type AttachmentKind,
  type FrStatus,
} from '@indotek/shared';
import type { FundRequestsService } from '../fund-requests/fund-requests.service';

export type FrView = Awaited<ReturnType<FundRequestsService['view']>>;

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const rp = (v: string | null | undefined) => (v == null ? '' : formatAngka(v, 0));
const pct = (v: string | null | undefined) => (v == null ? '' : formatPersen(v, 2));

function attachmentLabel(kind: AttachmentKind, fr: FrView): string {
  if (kind === 'PROYEKSI_BUDGET') return `Proyeksi budget proyek (sheet ${fr.project.code})`;
  if (kind === 'PO_SPK') return `PO / SPK dengan ${fr.client.name}`;
  return ATTACHMENT_LABEL[kind];
}

/** HTML Form Pengajuan Dana — meniru layout sheet "Form ADW" di docs/samples. */
export function renderFundRequestHtml(fr: FrView): string {
  const year = fr.tanggal?.slice(0, 4) ?? '';
  const lineRows = (section: 'A' | 'B') =>
    fr.lines
      .filter((l) => l.section === section)
      .map(
        (l, i) => `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(l.label)}</td>
          <td class="r">${pct(l.pctNilaiProyek)}</td>
          <td class="r">${rp(l.budgetAmount)}</td>
          <td class="r">${pct(l.pctCair)}</td>
          <td class="r b">${rp(l.diajukan)}</td>
          <td class="r">${rp(l.sudahTerpakai)}${Number(l.realisasiTanpaPengajuan) ? '<sup>*</sup>' : ''}</td>
          <td class="r ${Number(l.sisaBudget) < 0 ? 'neg' : ''}">${rp(l.sisaBudget)}</td>
          <td class="ket">${esc(l.keterangan)}</td>
        </tr>`,
      )
      .join('');
  const subtotal = (label: string, t: FrView['total'], cls = 'sub') => `<tr class="${cls}">
      <td></td><td>${label}</td>
      <td class="r">${pct(t.pctNilaiProyek)}</td>
      <td class="r">${rp(t.budgetAmount)}</td>
      <td></td>
      <td class="r">${rp(t.diajukan)}</td>
      <td class="r">${rp(t.sudahTerpakai)}</td>
      <td class="r">${rp(t.sisaBudget)}</td>
      <td></td></tr>`;

  const checkedKinds = new Set(fr.attachments.filter((a) => a.checked || a.hasFile).map((a) => a.kind));
  const lainnya = fr.attachments.filter((a) => a.kind === 'LAINNYA' && (a.checked || a.hasFile));
  const attItems = FORM_ATTACHMENT_KINDS.map((k) => {
    const label =
      k === 'LAINNYA'
        ? `Lainnya: ${esc(lainnya.map((a) => a.label || a.fileName).filter(Boolean).join(', ') || '...................')}`
        : esc(attachmentLabel(k, fr));
    return `<div class="att"><span class="box">${checkedKinds.has(k) ? '✓' : '&nbsp;'}</span>${label}</div>`;
  }).join('');

  const sig = (title: string, s: { name: string; at: Date | string | null } | null) => `
    <td class="sig">
      <div class="sig-title">${title}</div>
      <div class="sig-space">${s?.at ? '<span class="stamp">DISETUJUI SECARA ELEKTRONIK</span>' : ''}</div>
      <div>Nama: ${esc(s?.name ?? '')}</div>
      <div>Tgl: ${s?.at ? esc(formatTanggal(s.at)) : ''}</div>
    </td>`;

  const watermark: Partial<Record<FrStatus, string>> = { DRAFT: 'DRAFT', DITOLAK: 'DITOLAK' };
  const wm = watermark[fr.status];

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(fr.label)}</title>
<style>
  @page { size: A4 portrait; margin: 9mm 10mm 9mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8pt; color: #111; margin: 0; }
  .hdr { background: #FFD966; border: 1px solid #999; text-align: center; padding: 4px; }
  .hdr h1 { margin: 0; font-size: 13pt; letter-spacing: .5px; }
  .hdr div { font-size: 9pt; margin-top: 2px; }
  .meta { width: 100%; border-collapse: collapse; margin-top: 6px; }
  .meta td { padding: 1.5px 4px; border: 1px solid #bbb; }
  .meta td.k { background: #F2F2F2; width: 19%; font-weight: 600; white-space: nowrap; }
  .meta td.v { width: 31%; }
  .sec { background: #1F3864; color: #fff; font-weight: 700; padding: 2px 6px; margin-top: 6px; font-size: 8.4pt; }
  table.rin { width: 100%; border-collapse: collapse; }
  table.rin th, table.rin td { border: 1px solid #999; padding: 1.5px 3px; vertical-align: top; }
  table.rin th { background: #D9E1F2; font-size: 7.6pt; }
  table.rin tr.part td { background: #EDEDED; font-weight: 700; }
  table.rin tr.sub td { background: #F7F7F7; font-weight: 700; }
  table.rin tr.total td { background: #FFD966; font-weight: 700; }
  .r { text-align: right; white-space: nowrap; } .c { text-align: center; } .b { font-weight: 700; }
  .neg { color: #C00000; } .ket { font-size: 7.4pt; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv td { border: 1px solid #bbb; padding: 1.5px 4px; }
  table.kv td.k { width: 60%; background: #F2F2F2; }
  .box-text { border: 1px solid #bbb; padding: 3px 6px; min-height: 16px; }
  .terbilang { font-style: italic; font-weight: 600; }
  .atts { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; border: 1px solid #bbb; padding: 4px 6px; }
  .att .box { display: inline-block; width: 12px; height: 12px; border: 1px solid #333; text-align: center; line-height: 11px; margin-right: 5px; font-size: 9pt; }
  table.sigs { width: 100%; border-collapse: collapse; margin-top: 0; page-break-inside: avoid; }
  td.sig { width: 25%; border: 1px solid #999; padding: 4px; vertical-align: top; }
  .sig-title { font-weight: 700; text-align: center; }
  .sig-space { height: 40px; display: flex; align-items: center; justify-content: center; }
  .stamp { border: 1.5px solid #2E7D32; color: #2E7D32; font-size: 6.5pt; padding: 2px 4px; transform: rotate(-6deg); font-weight: 700; }
  .note { font-size: 7.2pt; color: #444; margin-top: 4px; }
  .approval { page-break-inside: avoid; break-inside: avoid; }
  .wm { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 96pt; color: rgba(200,0,0,.10); transform: rotate(-28deg); font-weight: 800; z-index: -1; }
  .status { float: right; font-size: 7.5pt; border: 1px solid #555; padding: 1px 5px; border-radius: 3px; background: #fff; }
</style></head>
<body>
${wm ? `<div class="wm">${wm}</div>` : ''}
<div class="hdr">
  <span class="status">${esc(FR_STATUS_LABEL[fr.status])}</span>
  <h1>FORM PENGAJUAN DANA</h1>
  <div>PT Indotek Buana Karya — Modal Kerja Proyek ${esc(fr.project.code)} ${esc(year)}</div>
</div>

<table class="meta">
  <tr><td class="k">No. Pengajuan</td><td class="v b">${esc(fr.label)}</td><td class="k">Diajukan Oleh</td><td class="v">${esc(fr.diajukanOleh.name)}</td></tr>
  <tr><td class="k">Tanggal Pengajuan</td><td class="v">${esc(formatTanggal(fr.tanggal))}</td><td class="k">Jabatan / Divisi</td><td class="v">${esc(fr.diajukanOleh.jabatan ?? '')}</td></tr>
  <tr><td class="k">Nama Proyek</td><td class="v b">${esc(fr.cluster.name)}</td><td class="k">Diajukan Kepada</td><td class="v">${esc(fr.diajukanKepada)}</td></tr>
  <tr><td class="k">Pemberi Kerja</td><td class="v">${esc(fr.client.name)}</td><td class="k">Termin Pencairan Ke-</td><td class="v">${fr.terminKe}</td></tr>
  <tr><td class="k">Nilai Proyek (Rp)</td><td class="v b">${rp(fr.snapshot.nilaiProyek)}</td><td class="k">Periode Penggunaan</td><td class="v">${esc(fr.periode ?? '')}</td></tr>
</table>

<div class="sec">RINCIAN KEBUTUHAN DANA</div>
<table class="rin">
  <thead><tr>
    <th style="width:4%">No</th><th style="width:20%">Pos Anggaran</th><th style="width:7%">% Nilai Proyek</th>
    <th style="width:11%">Budget (Rp)</th><th style="width:7%">% Dicairkan</th><th style="width:11%">Diajukan Saat Ini (Rp)</th>
    <th style="width:11%">Sudah Terpakai/ Dicairkan (Rp)</th><th style="width:11%">Sisa Budget (Rp)</th><th>Keterangan / Peruntukan</th>
  </tr></thead>
  <tbody>
    <tr class="part"><td class="c">A</td><td colspan="8">SUBCON, PERMIT &amp; PAJAK</td></tr>
    ${lineRows('A')}
    ${subtotal('Subtotal A', fr.subtotalA)}
    <tr class="part"><td class="c">B</td><td colspan="8">COST PROJECT</td></tr>
    ${lineRows('B')}
    ${subtotal('Subtotal B', fr.subtotalB)}
    ${subtotal('TOTAL PENGAJUAN', fr.total, 'total')}
  </tbody>
</table>
${
  Number(fr.total.realisasiTanpaPengajuan)
    ? `<div class="note">* Sudah Terpakai/Dicairkan = dana dicairkan lewat pengajuan + realisasi di luar pengajuan; termasuk realisasi sebelum sistem (Rp ${rp(fr.total.realisasiTanpaPengajuan)}).</div>`
    : ''
}

<div class="sec">INFORMASI PENDUKUNG (tidak termasuk pengajuan)</div>
<table class="kv">
  <tr><td class="k">Beban bunga dana investor (${pct(fr.snapshot.interestRate).replace(',00', '')} × dana investor)</td><td class="r">${rp(fr.snapshot.infoBunga)}</td></tr>
  <tr><td class="k">Cadangan budget / retensi${fr.snapshot.retensiAsCost ? '' : ' (tidak dihitung sebagai biaya)'}</td><td class="r">${rp(fr.snapshot.infoRetensi)}</td></tr>
  <tr><td class="k">Proyeksi profit cluster</td><td class="r ${Number(fr.snapshot.infoProfit) < 0 ? 'neg' : ''}">${rp(fr.snapshot.infoProfit)}</td></tr>
  <tr><td class="k">Margin profit</td><td class="r ${Number(fr.snapshot.infoMargin) < 0 ? 'neg' : ''}">${pct(fr.snapshot.infoMargin)}</td></tr>
</table>

<div class="sec">TERBILANG</div>
<div class="box-text terbilang">${esc(fr.terbilang)}</div>

<div class="sec">TUJUAN / JUSTIFIKASI PENGGUNAAN DANA</div>
<div class="box-text">${esc(fr.justifikasi)}</div>

<div class="sec">REKENING TUJUAN PENCAIRAN</div>
<table class="kv">
  <tr><td class="k" style="width:25%">Nama Bank</td><td>${esc(fr.rekeningBank ?? '')}</td></tr>
  <tr><td class="k" style="width:25%">No. Rekening</td><td>${esc(fr.rekeningNo ?? '')}</td></tr>
  <tr><td class="k" style="width:25%">Atas Nama</td><td>${esc(fr.rekeningNama ?? '')}</td></tr>
</table>

<div class="sec">LAMPIRAN (beri tanda ✓)</div>
<div class="atts">${attItems}</div>

<div class="approval">
<div class="sec">PERSETUJUAN</div>
<table class="sigs"><tr>
  ${sig('Diajukan oleh', fr.signatures.DIAJUKAN)}
  ${sig('Diperiksa oleh (Finance)', fr.signatures.PERIKSA_FINANCE)}
  ${sig('Disetujui oleh (Direktur)', fr.signatures.SETUJU_DIREKTUR)}
  ${sig('Mengetahui (Investor)', fr.signatures.MENGETAHUI_INVESTOR)}
</tr></table>
</div>

<div class="note">
  ${fr.status === 'DICAIRKAN' && fr.cairTanggal ? `Dana dicairkan tanggal ${esc(formatTanggal(fr.cairTanggal))}${fr.signatures.PENCAIRAN ? ` oleh ${esc(fr.signatures.PENCAIRAN.name)}` : ''}.<br>` : ''}
  ${fr.overrideReason ? `Override sisa budget oleh ${esc(fr.overrideBy?.name ?? 'Admin')}: ${esc(fr.overrideReason)}<br>` : ''}
  ${fr.status === 'DITOLAK' && fr.rejectedNote ? `Alasan penolakan: ${esc(fr.rejectedNote)}<br>` : ''}
  • Bunga dana investor &amp; retensi tidak termasuk dana yang diajukan.
  ${fr.live ? '• Draft: angka mengikuti budget terkini dan dibekukan saat diajukan.' : ''}
</div>
</body></html>`;
}
