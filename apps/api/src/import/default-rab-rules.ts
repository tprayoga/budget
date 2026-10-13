import type { PrismaClient } from '@prisma/client';
import type { RabDecision } from '@indotek/shared';

/**
 * Aturan pemetaan default import RAB (keputusan review Fase 2 / 2.1), supaya file RAB contoh
 * bisa diimpor sekali jalan. Cluster dicari berdasarkan nama; aturan yang sudah ada TIDAK ditimpa.
 * Kunci: mappingKey grup (RAB:{sheet}:{section}:{judul}) atau sourceRef item (RAB:{sheet}!{sel}).
 */
type RuleSpec = {
  key: string;
  project: string;
  decision: Omit<RabDecision, 'clusterId' | 'clusterIds'> & { clusterNames?: string[] };
};

const MANADO = ['Kalawiran Kakas Barat (Manado)', 'Karondoran Langowan Timur (Manado)'];
const EVANTAMA_ALL = ['Cluster Sinagar Tasik', 'Cluster Kersanagara RW 08 Tasik', 'Cluster Kersanagara RW 04 Tasik'];

export const DEFAULT_RAB_RULES: RuleSpec[] = [
  // Evantama — Biaya OPS teknisi (grup "Cluster Sinagar & Kersanegara Tasik") dibagi rata 3 cluster (= D67/3 di Excel)
  { key: 'RAB:EVANTAMA:OPS:Cluster Sinagar & Kersanegara Tasik', project: 'EVANTAMA', decision: { scope: 'PROJECT', method: 'EQUAL', clusterNames: EVANTAMA_ALL } },
  // Evantama — ringkasan PJD E144:G148 duplikat daftar PJD → dilewati
  ...['G145', 'G147', 'G148'].map((cell): RuleSpec => ({
    key: `RAB:EVANTAMA!${cell}`,
    project: 'EVANTAMA',
    decision: { scope: 'SKIP', note: 'Ringkasan PJD (E144:G148) duplikat daftar Biaya PJD' },
  })),

  // CCSI Site Manado — jasa subcon pro-rata nilai PO implementasi (subcon = 57% × nilai implementasi per cluster)
  ...['D35', 'D37', 'D38'].map((cell): RuleSpec => ({
    key: `RAB:CCSI!${cell}`,
    project: 'CCSI',
    decision: { scope: 'PROJECT', method: 'PRO_RATA_PO', clusterNames: MANADO },
  })),
  // CCSI Site Manado — biaya operasional site (Allowance Doc SND & Mob Demob) rata 2 cluster
  { key: 'RAB:CCSI!D36', project: 'CCSI', decision: { scope: 'PROJECT', method: 'EQUAL', clusterNames: MANADO, category: 'PJD' } },
  // CCSI Site Manado — biaya permit: metode alokasi belum diputuskan → ditahan
  { key: 'RAB:CCSI!D31', project: 'CCSI', decision: { scope: 'HOLD', note: 'Permit Site Manado 22.000.000 — metode alokasi ke 2 cluster belum diputuskan' } },

  // CCSI daftar "Keterangan" (A53:C61) — rata ke 2 cluster Manado (= /2 di Excel)
  { key: 'RAB:CCSI:LIST:', project: 'CCSI', decision: { scope: 'PROJECT', method: 'EQUAL', clusterNames: MANADO } },
  { key: 'RAB:CCSI!C54', project: 'CCSI', decision: { scope: 'INHERIT', category: 'TICKET' } },
  { key: 'RAB:CCSI!C55', project: 'CCSI', decision: { scope: 'INHERIT', category: 'HOMEBASE' } },
  { key: 'RAB:CCSI!C56', project: 'CCSI', decision: { scope: 'INHERIT', category: 'MOTOR_MOBIL' } },
  { key: 'RAB:CCSI!C59', project: 'CCSI', decision: { scope: 'INHERIT', category: 'MOTOR_MOBIL' } },
  // kasbon → pos Operational Kantor (rumus E19 = (kasbon + OPS)/2)
  { key: 'RAB:CCSI!C57', project: 'CCSI', decision: { scope: 'INHERIT', category: 'OPS', note: 'kasbon — perlu penyelesaian' } },
  { key: 'RAB:CCSI!C60', project: 'CCSI', decision: { scope: 'INHERIT', category: 'OPS' } },
  { key: 'RAB:CCSI!C61', project: 'CCSI', decision: { scope: 'INHERIT', category: 'OPS' } },
  // bertanda "????" di sheet dan tidak dipakai rumus mana pun
  { key: 'RAB:CCSI!C58', project: 'CCSI', decision: { scope: 'HOLD', note: 'Bertanda "????" di sheet, tidak dipakai rumus mana pun — perlu konfirmasi' } },

  // ADW pembelian material (baris 78–81) — hasil cek duplikat (lihat CHANGELOG 2.1)
  {
    key: 'RAB:ADW!C78',
    project: 'ADW',
    decision: { scope: 'DUPLICATE', note: 'DUPLIKAT: 4.275.000 tgl 10/08/2026 = buku kas "Pembelian Material Kersanegara RW 08" (EVANTAMA) dan sudah masuk EVANTAMA!M42 (Material Kersanegara)' },
  },
  {
    key: 'RAB:ADW!C79',
    project: 'ADW',
    decision: {
      scope: 'HOLD',
      category: 'SUBCON_MATERIAL',
      note: 'Kemungkinan duplikat: 5 sel "Material Ngawi" (Y38+AC38+AG38+AK38+AO38 = 20.814.181,21) ≈ 18.386.500 + Tmbhn Material Tepas Ngawi 2.425.000 (selisih 2.681,21). Bila bukan duplikat: PRO_RATA_PO ke 5 cluster TEPAS NGAWI.',
    },
  },
  {
    key: 'RAB:ADW!C80',
    project: 'ADW',
    decision: { scope: 'DUPLICATE', note: 'DUPLIKAT: 4.390.600 = BI38 2.959.400 + BM37 1.431.200 (Total Material 2 cluster GUNUNGTAWANG WONOSOBO)' },
  },
  {
    key: 'RAB:ADW!C81',
    project: 'ADW',
    decision: { scope: 'HOLD', category: 'SUBCON_MATERIAL', note: 'Material FTTH 22/08/2026 — buku kas: "DS & SF Desa Mangunsari Pemalang"; perlu konfirmasi' },
  },
];

/** Seed aturan default (insert-only). Mengembalikan jumlah aturan yang dibuat. */
export async function seedDefaultRabRules(prisma: PrismaClient, userId: string | null = null): Promise<number> {
  let created = 0;
  for (const r of DEFAULT_RAB_RULES) {
    if (await prisma.importMappingRule.findUnique({ where: { sourceKey: r.key } })) continue;
    const project = await prisma.project.findUnique({ where: { code: r.project } });
    if (!project) continue;
    const { clusterNames, ...d } = r.decision;
    let clusterIds: string[] = [];
    if (clusterNames?.length) {
      const cs = await prisma.cluster.findMany({ where: { projectId: project.id, name: { in: clusterNames } } });
      if (cs.length !== clusterNames.length) continue; // cluster belum ada → lewati aturan
      clusterIds = clusterNames.map((n) => cs.find((c) => c.name === n)!.id);
    }
    await prisma.importMappingRule.create({
      data: {
        sourceKey: r.key,
        projectId: project.id,
        scope: d.scope,
        clusterId: null,
        clusterIds,
        method: d.method ?? null,
        category: d.category ?? null,
        note: d.note ?? null,
        createdById: userId,
      },
    });
    created++;
  }
  return created;
}
