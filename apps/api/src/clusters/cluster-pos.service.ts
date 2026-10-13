import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoKind, Prisma } from '@prisma/client';
import { poAmountError, type ClusterPoInput, type ClusterPoUpdateInput } from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../auth/auth.types';
import { money } from '../common/decimal';
import { generateClientPayments } from '../realization/termin-generator';
import { scanOverruns } from '../notifications/overrun';
import { ensureClusterPos, markOverride, poDto, poFlat, syncDerivedFromPos } from './po-support';

const day = (v: string) => new Date(`${v}T00:00:00Z`);

/** Field turunan cluster yang terdampak perubahan PO jenis tertentu. */
function affectedFields(kind: PoKind, passThroughChanged: boolean) {
  const f: string[] = kind === 'PERMIT' || kind === 'SND' ? ['nilaiPoPermit'] : ['nilaiPoImpl'];
  if (passThroughChanged) f.push('permitCost');
  return f;
}

/**
 * PO per cluster (IMPLEMENTASI / PERMIT / SND / ADDWORK / DEDUCTION). Setiap perubahan:
 * nilai turunan cluster dihitung ulang, field ditandai "diedit di aplikasi" (dilindungi dari import budget),
 * tercatat di AuditLog (PO & nilai cluster lama → baru). PO baru langsung dibuatkan termin klien.
 */
@Injectable()
export class ClusterPosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async list(user: AuthUser, clusterId: string) {
    await this.access.assertCluster(user, clusterId);
    const pos = await this.prisma.clusterPo.findMany({ where: { clusterId }, orderBy: { createdAt: 'asc' } });
    return pos.map(poDto);
  }

  private async afterChange(tx: Tx, user: AuthUser, clusterId: string, fields: string[]) {
    const d = await syncDerivedFromPos(tx, clusterId);
    await this.audit.diff(tx, user.id, 'Cluster', clusterId, d.before, { ...d.after, sumber: 'tabel PO' });
    await markOverride(tx, clusterId, fields, user.id);
  }

  async create(user: AuthUser, clusterId: string, input: ClusterPoInput) {
    await this.access.assertCluster(user, clusterId);
    const err = poAmountError(input.kind, input.amount);
    if (err) throw new BadRequestException(err);
    const res = await this.prisma.$transaction(async (tx) => {
      await ensureClusterPos(tx, clusterId);
      const po = await tx.clusterPo.create({
        data: {
          clusterId,
          kind: input.kind,
          poNumber: input.poNumber || null,
          poDate: input.poDate ? day(input.poDate) : null,
          amount: money(input.amount),
          passThroughCost: money(input.passThroughCost ?? '0'),
          note: input.note || null,
        },
      });
      await this.audit.diff(tx, user.id, 'ClusterPo', po.id, null, poFlat(po)!);
      await this.afterChange(tx, user, clusterId, affectedFields(po.kind, !po.passThroughCost.isZero()));
      await generateClientPayments(tx, clusterId, po.id);
      return po;
    });
    await scanOverruns(this.prisma, [clusterId]);
    return poDto(res);
  }

  async update(user: AuthUser, id: string, input: ClusterPoUpdateInput) {
    const before = await this.prisma.clusterPo.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('PO tidak ditemukan');
    await this.access.assertCluster(user, before.clusterId);
    if (input.amount !== undefined) {
      const err = poAmountError(before.kind, input.amount);
      if (err) throw new BadRequestException(err);
    }
    const res = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ClusterPoUpdateInput = {};
      if (input.poNumber !== undefined) data.poNumber = input.poNumber || null;
      if (input.poDate !== undefined) data.poDate = input.poDate ? day(input.poDate) : null;
      if (input.amount !== undefined) data.amount = money(input.amount);
      if (input.passThroughCost !== undefined) data.passThroughCost = money(input.passThroughCost);
      if (input.note !== undefined) data.note = input.note || null;
      const after = await tx.clusterPo.update({ where: { id }, data });
      await this.audit.diff(tx, user.id, 'ClusterPo', id, poFlat(before), poFlat(after)!);
      const amountChanged = !before.amount.eq(after.amount);
      const costChanged = !before.passThroughCost.eq(after.passThroughCost);
      if (amountChanged || costChanged) {
        const fields = affectedFields(after.kind, costChanged).filter((f) => f === 'permitCost' || amountChanged);
        await this.afterChange(tx, user, after.clusterId, fields);
      }
      return after;
    });
    await scanOverruns(this.prisma, [res.clusterId]);
    return poDto(res);
  }

  /** Hapus PO beserta termin UNBILLED-nya; ditolak bila ada termin yang sudah ditagih/dibayar. */
  async remove(user: AuthUser, id: string) {
    const po = await this.prisma.clusterPo.findUnique({ where: { id }, include: { termins: true } });
    if (!po) throw new NotFoundException('PO tidak ditemukan');
    await this.access.assertCluster(user, po.clusterId);
    if (po.termins.some((t) => t.status !== 'UNBILLED')) throw new ConflictException('PO memiliki termin yang sudah ditagih/dibayar — tidak bisa dihapus');
    const count = await this.prisma.clusterPo.count({ where: { clusterId: po.clusterId, kind: 'IMPLEMENTASI' } });
    if (po.kind === 'IMPLEMENTASI' && count === 1) throw new ConflictException('PO implementasi terakhir tidak bisa dihapus; ubah nilainya');
    await this.prisma.$transaction(async (tx) => {
      await tx.clusterPo.delete({ where: { id } });
      await this.audit.diff(tx, user.id, 'ClusterPo', id, poFlat(po), { status: 'DIHAPUS' });
      await this.afterChange(tx, user, po.clusterId, affectedFields(po.kind, !po.passThroughCost.isZero()));
    });
    await scanOverruns(this.prisma, [po.clusterId]);
    return { ok: true };
  }
}
