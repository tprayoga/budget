import { BUDGET_LABEL, EXPENSE_CATEGORY_LABEL, formatAngka, formatTanggal, type ExpenseCategory, type FrCode } from '@indotek/shared';

export interface RealizationReportData {
  fr: {
    label: string;
    terminKe: number;
    cairTanggal: string | null;
    cluster: string;
    project: string;
    client: string;
  };
  usage: { rows: { code: FrCode; cair: string; realisasi: string; sisa: string }[]; total: { cair: string; realisasi: string; sisa: string } };
  expenses: {
    date: string | null;
    category: ExpenseCategory;
    description: string;
    vendor: string | null;
    invoiceNo: string | null;
    amount: string;
  }[];
  generatedAt: Date;
  generatedBy: string;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const rp = (v: string) => formatAngka(v, 0);
const neg = (v: string) => (Number(v) < 0 ? 'neg' : '');

/** Laporan realisasi penggunaan dana satu pengajuan (lampiran untuk termin berikutnya). */
export function renderRealizationReportHtml(d: RealizationReportData): string {
  const rows = d.usage.rows.filter((r) => Number(r.cair) !== 0 || Number(r.realisasi) !== 0);
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan Realisasi ${esc(d.fr.label)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 11mm; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8.6pt; color: #111; }
  .hdr { background: #FFD966; border: 1px solid #999; text-align: center; padding: 5px; }
  .hdr h1 { margin: 0; font-size: 13pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 2px 4px; }
  th { background: #D9E1F2; font-size: 7.8pt; }
  .r { text-align: right; white-space: nowrap; } .neg { color: #C00000; }
  .tot td { background: #FFD966; font-weight: 700; }
  .meta td { border: 1px solid #ccc; } .meta td.k { background: #F2F2F2; font-weight: 600; width: 20%; }
  .sec { background: #1F3864; color: #fff; font-weight: 700; padding: 3px 6px; margin-top: 10px; }
  .note { font-size: 7.4pt; color: #444; margin-top: 6px; }
</style></head><body>
<div class="hdr"><h1>LAPORAN REALISASI PENGGUNAAN DANA</h1><div>PT Indotek Buana Karya — ${esc(d.fr.project)}</div></div>
<table class="meta">
  <tr><td class="k">No. Pengajuan</td><td>${esc(d.fr.label)}</td><td class="k">Termin ke-</td><td>${d.fr.terminKe}</td></tr>
  <tr><td class="k">Cluster</td><td>${esc(d.fr.cluster)}</td><td class="k">Pemberi kerja</td><td>${esc(d.fr.client)}</td></tr>
  <tr><td class="k">Tanggal cair</td><td>${esc(formatTanggal(d.fr.cairTanggal))}</td><td class="k">Dibuat</td><td>${esc(formatTanggal(d.generatedAt))} oleh ${esc(d.generatedBy)}</td></tr>
</table>
<div class="sec">DANA CAIR vs REALISASI vs SISA DANA DI TANGAN</div>
<table>
  <thead><tr><th>Pos anggaran</th><th>Dana cair (Rp)</th><th>Realisasi (Rp)</th><th>Sisa di tangan (Rp)</th></tr></thead>
  <tbody>
    ${rows.map((r) => `<tr><td>${esc(BUDGET_LABEL[r.code])}</td><td class="r">${rp(r.cair)}</td><td class="r">${rp(r.realisasi)}</td><td class="r ${neg(r.sisa)}">${rp(r.sisa)}</td></tr>`).join('')}
    <tr class="tot"><td>TOTAL</td><td class="r">${rp(d.usage.total.cair)}</td><td class="r">${rp(d.usage.total.realisasi)}</td><td class="r ${neg(d.usage.total.sisa)}">${rp(d.usage.total.sisa)}</td></tr>
  </tbody>
</table>
<div class="sec">RINCIAN REALISASI (terverifikasi Finance)</div>
<table>
  <thead><tr><th>No</th><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th>Vendor / Invoice</th><th>Nominal (Rp)</th></tr></thead>
  <tbody>
    ${d.expenses.length ? d.expenses.map((e, i) => `<tr><td class="r">${i + 1}</td><td>${esc(formatTanggal(e.date))}</td><td>${esc(EXPENSE_CATEGORY_LABEL[e.category])}</td><td>${esc(e.description)}</td><td>${esc([e.vendor, e.invoiceNo].filter(Boolean).join(' / '))}</td><td class="r">${rp(e.amount)}</td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:#666">Belum ada realisasi yang ditautkan.</td></tr>'}
  </tbody>
</table>
<div class="note">Hanya realisasi berstatus TERVERIFIKASI yang ditautkan ke pengajuan ini yang dihitung. Untuk biaya level project, nominal = porsi alokasi cluster ini.</div>
</body></html>`;
}
