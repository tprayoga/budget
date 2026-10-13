import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  aggregateFrHistory,
  BUDGET_LABEL,
  BUDGET_LINE_CODES,
  clusterResultToDto,
  FR_CODES,
  frBudgetAmounts,
  roundHalfUp,
  type BudgetLineDto,
  type ClusterCreateInput,
  type ClusterUpdateInput,
} from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { BudgetService } from '../budget/budget.service';
import { TemplatesService } from '../settings/templates.service';
import type { AuthUser } from '../auth/auth.types';
import { money, rate } from '../common/decimal';
import { clusterDto, type ClusterWithLines } from '../budget/budget.mapper';
import { generateClientPayments } from '../realization/termin-generator';
import { ensureClusterPos, markOverride, poDto, PO_DERIVED_FIELDS } from './po-support';
import { realisasiTanpaPengajuan } from '../fund-requests/realisasi-tanpa-pengajuan';

const CLUSTER_FIELDS = [
  'name',
  'info',
  'note',
  'terminOffset',
  'division',
  'status',
  'nilaiPoImpl',
  'nilaiPoPermit',
  'permitCost',
  'pajakRate',
  'retensiRate',
  'implementationDate',
] as const;

/** Representasi datar cluster untuk audit log (field → nilai string). */
function flatForAudit(c: ReturnType<typeof clusterDto> | null) {
  if (!c) return null;
  const o: Record<string, string | null> = {};
  for (const f of CLUSTER_FIELDS) o[f] = c[f] === null || c[f] === undefined ? null : String(c[f]);
  for (const l of c.lines) {
    o[`line.${l.code}.mode`] = l.mode;
    o[`line.${l.code}.pct`] = l.pct;
    o[`line.${l.code}.amount`] = l.amount;
  }
  return o;
}

function lineData(l: BudgetLineDto) {
  return {
    mode: l.mode,
    pct: l.mode === 'PCT' ? rate(l.pct ?? 0) : null,
    amount: l.mode === 'RP' ? money(l.amount ?? 0) : null,
  };
}

@Injectable()
export class ClustersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly budget: BudgetService,
    private readonly templates: TemplatesService,
  ) {}

  private load(id: string, tx: Tx | PrismaService = this.prisma): Promise<ClusterWithLines | null> {
    return tx.cluster.findUnique({ where: { id }, include: { budgetLines: true } });
  }

  async list(user: AuthUser, projectId?: string) {
    if (projectId) await this.access.assertProject(user, projectId);
    const clusters = await this.prisma.cluster.findMany({
      where: { ...this.access.clusterWhere(user), ...(projectId ? { projectId } : {}) },
      include: { budgetLines: true, project: { select: { code: true, name: true } } },
      orderBy: [{ projectId: 'asc' }, { sortOrder: 'asc' }],
    });
    return clusters.map((c) => ({ ...clusterDto(c), project: c.project }));
  }

  /** Detail cluster + kalkulasi + pemakaian budget per pos (sudah cair, sedang diproses, sisa). */
  async get(user: AuthUser, id: string) {
    await this.access.assertCluster(user, id);
    const c = await this.prisma.cluster.findUniqueOrThrow({
      where: { id },
      include: {
        budgetLines: true,
        project: { include: { client: true } },
        fundRequests: {
          include: { lines: true, diajukanOleh: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        },
        pos: { orderBy: { createdAt: 'asc' } },
      },
    });
    const overrides = await this.prisma.fieldOverride.findMany({ where: { entity: 'Cluster', entityId: id }, orderBy: { field: 'asc' } });
    const setting = await this.budget.settingFor(c.projectId);
    const result = this.budget.calc(c, setting);
    const budgetByCode = frBudgetAmounts(result);
    const hist = aggregateFrHistory(
      c.fundRequests.map((f) => ({
        id: f.id,
        status: f.status,
        lines: f.lines.map((l) => ({ budgetCode: l.budgetCode, diajukan: l.diajukan.toString(), pctCair: l.pctCair.toString() })),
      })),
      null,
      c.terminOffset,
    );
    const real = await realisasiTanpaPengajuan(this.prisma, id);
    const usage = FR_CODES.map((code) => {
      const budgetRp = roundHalfUp(budgetByCode[code], 0);
      const sudah = hist.sudahDicairkanSebelum[code];
      const sedang = hist.sedangDiproses[code];
      return {
        code,
        label: BUDGET_LABEL[code],
        budget: budgetRp.toFixed(2),
        sudahDicairkan: sudah.toFixed(2),
        sedangDiproses: sedang.toFixed(2),
        realisasiTanpaPengajuan: real[code].toFixed(2),
        sisa: budgetRp.minus(sudah).minus(sedang).minus(real[code]).toFixed(2),
      };
    });
    return {
      ...clusterDto(c),
      project: { id: c.project.id, code: c.project.code, name: c.project.name, client: c.project.client },
      setting,
      calc: clusterResultToDto(result),
      pos: c.pos.map(poDto),
      overrides: overrides.map((o) => ({ field: o.field, userId: o.userId, reason: o.reason, at: o.at })),
      usage,
      nextTerminKe: hist.terminKe,
      fundRequests: c.fundRequests.map((f) => ({
        id: f.id,
        number: f.number,
        status: f.status,
        terminKe: f.terminKe,
        tanggal: f.tanggal,
        totalDiajukan: f.totalDiajukan.toString(),
        diajukanOleh: f.diajukanOleh.name,
      })),
    };
  }

  async create(user: AuthUser, input: ClusterCreateInput) {
    await this.access.assertProject(user, input.projectId);
    const tpl = await this.templates.effective(input.projectId);
    const lines: BudgetLineDto[] = BUDGET_LINE_CODES.map((code) => {
      const given = input.lines?.find((l) => l.code === code);
      if (given) return given;
      const t = tpl.lines.find((l) => l.code === code)!;
      return { code, mode: t.mode, pct: t.pct ?? undefined, amount: t.amount ?? undefined };
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const max = await tx.cluster.aggregate({ where: { projectId: input.projectId }, _max: { sortOrder: true } });
        const created = await tx.cluster.create({
          data: {
            projectId: input.projectId,
            name: input.name,
            info: input.info ?? null,
            note: input.note ?? null,
            division: input.division ?? null,
            status: input.status,
            nilaiPoImpl: money(input.nilaiPoImpl),
            nilaiPoPermit: money(input.nilaiPoPermit),
            permitCost: money(input.permitCost),
            pajakRate: rate(input.pajakRate ?? tpl.pajakRate),
            retensiRate: rate(input.retensiRate ?? tpl.retensiRate),
            implementationDate: input.implementationDate ? new Date(`${input.implementationDate}T00:00:00Z`) : null,
            sortOrder: (max._max.sortOrder ?? -1) + 1,
            budgetLines: {
              create: lines.map((l, i) => ({ code: l.code, label: BUDGET_LABEL[l.code], sortOrder: i, ...lineData(l) })),
            },
          },
          include: { budgetLines: true },
        });
        const dto = clusterDto(created);
        await this.audit.diff(tx, user.id, 'Cluster', created.id, null, flatForAudit(dto)!);
        // PO awal dari nilai input (IMPLEMENTASI + PERMIT bila ada), lalu termin klien per PO dari template
        await ensureClusterPos(tx, created.id);
        await generateClientPayments(tx, created.id);
        return dto;
      });
    } catch (e) {
      this.rethrowUnique(e);
    }
  }

  async update(user: AuthUser, id: string, input: ClusterUpdateInput) {
    await this.access.assertCluster(user, id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await this.load(id, tx);
        if (!before) throw new NotFoundException('Cluster tidak ditemukan');
        const data: Prisma.ClusterUpdateInput = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.info !== undefined) data.info = input.info ?? null;
        if (input.note !== undefined) data.note = input.note || null;
        if (input.terminOffset !== undefined && input.terminOffset !== before.terminOffset) {
          if (user.role !== 'ADMIN') throw new ForbiddenException('Hanya ADMIN yang boleh mengubah jumlah termin sebelum sistem');
          data.terminOffset = input.terminOffset;
        }
        if (input.division !== undefined) data.division = input.division ?? null;
        if (input.status !== undefined) data.status = input.status;
        // Fase 2.3: nilai PO & biaya permit diturunkan dari tabel PO — edit lewat PO, bukan langsung
        for (const f of PO_DERIVED_FIELDS) {
          if (input[f] !== undefined && !before[f].eq(input[f]!)) {
            throw new BadRequestException('Nilai PO / biaya permit diturunkan dari tabel PO cluster — ubah lewat tabel PO');
          }
        }
        if (input.pajakRate !== undefined) data.pajakRate = rate(input.pajakRate);
        if (input.retensiRate !== undefined) data.retensiRate = rate(input.retensiRate);
        if (input.implementationDate !== undefined) {
          data.implementationDate = input.implementationDate ? new Date(`${input.implementationDate}T00:00:00Z`) : null;
        }
        await tx.cluster.update({ where: { id }, data });
        await this.upsertLines(tx, id, input.lines ?? []);
        const after = (await this.load(id, tx))!;
        const dto = clusterDto(after);
        const flatBefore = flatForAudit(clusterDto(before))!;
        const flatAfter = flatForAudit(dto)!;
        await this.audit.diff(tx, user.id, 'Cluster', id, flatBefore, flatAfter);
        // tandai field yang diedit di aplikasi → dilindungi dari import budget Excel
        const changed = Object.keys(flatAfter).filter((k) => flatAfter[k] !== flatBefore[k]);
        await markOverride(tx, id, changed, user.id);
        return dto;
      });
    } catch (e) {
      this.rethrowUnique(e);
    }
  }

  async updateLines(user: AuthUser, id: string, lines: BudgetLineDto[]) {
    return this.update(user, id, { lines });
  }

  private async upsertLines(tx: Tx, clusterId: string, lines: BudgetLineDto[]) {
    for (const l of lines) {
      await tx.budgetLine.upsert({
        where: { clusterId_code: { clusterId, code: l.code } },
        create: {
          clusterId,
          code: l.code,
          label: BUDGET_LABEL[l.code],
          sortOrder: BUDGET_LINE_CODES.indexOf(l.code),
          ...lineData(l),
        },
        update: lineData(l),
      });
    }
  }

  /** Salin cluster beserta budget lines ke cluster baru (status PLAN). */
  async duplicate(user: AuthUser, id: string, name: string) {
    const src = await this.access.assertCluster(user, id);
    const full = (await this.load(src.id))!;
    return this.create(user, {
      projectId: full.projectId,
      name,
      info: full.info,
      division: full.division,
      status: 'PLAN',
      nilaiPoImpl: full.nilaiPoImpl.toString(),
      nilaiPoPermit: full.nilaiPoPermit.toString(),
      permitCost: full.permitCost.toString(),
      pajakRate: full.pajakRate.toString(),
      retensiRate: full.retensiRate.toString(),
      implementationDate: full.implementationDate ? full.implementationDate.toISOString().slice(0, 10) : null,
      lines: full.budgetLines.map((l) => ({
        code: l.code,
        mode: l.mode,
        pct: l.pct?.toString() ?? null,
        amount: l.amount?.toString() ?? null,
      })),
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.access.assertCluster(user, id);
    const used = await this.prisma.fundRequest.count({ where: { clusterId: id } });
    if (used) throw new ConflictException('Cluster sudah memiliki pengajuan dana; ubah status menjadi CANCELLED');
    const realized = await this.prisma.expenseAllocation.count({ where: { clusterId: id } });
    const billed = await this.prisma.clientPayment.count({ where: { clusterId: id, status: { not: 'UNBILLED' } } });
    if (realized || billed) throw new ConflictException('Cluster sudah memiliki realisasi/tagihan klien; ubah status menjadi CANCELLED');
    await this.prisma.$transaction(async (tx) => {
      const before = await this.load(id, tx);
      await tx.cluster.delete({ where: { id } });
      await this.audit.diff(tx, user.id, 'Cluster', id, { name: before?.name ?? null }, { name: null });
    });
    return { ok: true };
  }

  private rethrowUnique(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException('Nama cluster sudah dipakai di project ini');
    }
    throw e;
  }
}
