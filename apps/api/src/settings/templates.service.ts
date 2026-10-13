import { Injectable } from '@nestjs/common';
import type { BudgetTemplate, BudgetTemplateLine } from '@prisma/client';
import { BUDGET_LINE_CODES, BUDGET_LABEL, type BudgetLineDto, type BudgetLineCode } from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { money, rate, s } from '../common/decimal';

export interface EffectiveTemplate {
  pajakRate: string;
  retensiRate: string;
  lines: { code: BudgetLineCode; label: string; mode: 'PCT' | 'RP'; pct: string | null; amount: string | null }[];
}

type TemplateWithLines = BudgetTemplate & { lines: BudgetTemplateLine[] };

function dto(t: TemplateWithLines | null) {
  if (!t) return null;
  return {
    id: t.id,
    projectId: t.projectId,
    pajakRate: s(t.pajakRate),
    retensiRate: s(t.retensiRate),
    lines: t.lines.map((l) => ({ code: l.code, mode: l.mode, pct: s(l.pct), amount: s(l.amount) })),
  };
}

/**
 * Template budget default untuk cluster baru. Disimpan di DB (tidak di-hardcode);
 * template project meng-override template global per pos dan per rate.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private find(projectId: string | null, tx: Tx | PrismaService = this.prisma) {
    return tx.budgetTemplate.findFirst({ where: { projectId }, include: { lines: true } });
  }

  async get(projectId: string | null) {
    return { own: dto(await this.find(projectId)), effective: await this.effective(projectId) };
  }

  async effective(projectId: string | null, tx: Tx | PrismaService = this.prisma): Promise<EffectiveTemplate> {
    const global = await this.find(null, tx);
    const own = projectId ? await this.find(projectId, tx) : null;
    const lineOf = (code: BudgetLineCode) =>
      own?.lines.find((l) => l.code === code) ?? global?.lines.find((l) => l.code === code);
    return {
      pajakRate: s(own?.pajakRate ?? global?.pajakRate ?? null) ?? '0',
      retensiRate: s(own?.retensiRate ?? global?.retensiRate ?? null) ?? '0',
      lines: BUDGET_LINE_CODES.map((code) => {
        const l = lineOf(code);
        return {
          code,
          label: BUDGET_LABEL[code],
          mode: l?.mode ?? 'PCT',
          pct: l ? s(l.pct) : '0',
          amount: l ? s(l.amount) : null,
        };
      }),
    };
  }

  async upsert(
    userId: string,
    projectId: string | null,
    input: { pajakRate?: string | null; retensiRate?: string | null; lines?: BudgetLineDto[] },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.find(projectId, tx);
      const data = {
        pajakRate: input.pajakRate === undefined ? undefined : input.pajakRate === null ? null : rate(input.pajakRate),
        retensiRate:
          input.retensiRate === undefined ? undefined : input.retensiRate === null ? null : rate(input.retensiRate),
      };
      const t = before
        ? await tx.budgetTemplate.update({ where: { id: before.id }, data })
        : await tx.budgetTemplate.create({ data: { ...data, projectId } });
      for (const l of input.lines ?? []) {
        const values = {
          mode: l.mode,
          pct: l.mode === 'PCT' ? rate(l.pct ?? 0) : null,
          amount: l.mode === 'RP' ? money(l.amount ?? 0) : null,
        };
        await tx.budgetTemplateLine.upsert({
          where: { templateId_code: { templateId: t.id, code: l.code } },
          create: { templateId: t.id, code: l.code, ...values },
          update: values,
        });
      }
      const after = await this.find(projectId, tx);
      const flat = (x: ReturnType<typeof dto>) => {
        const o: Record<string, string | null> = { pajakRate: x?.pajakRate ?? null, retensiRate: x?.retensiRate ?? null };
        for (const l of x?.lines ?? []) {
          o[`line.${l.code}.mode`] = l.mode;
          o[`line.${l.code}.pct`] = l.pct;
          o[`line.${l.code}.amount`] = l.amount;
        }
        return o;
      };
      await this.audit.diff(tx, userId, 'BudgetTemplate', t.id, flat(dto(before)), flat(dto(after)));
      return dto(after);
    });
  }
}
