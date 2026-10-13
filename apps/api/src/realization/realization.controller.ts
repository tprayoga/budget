import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  categoryMappingSchema,
  applyInvoiceRefSchema,
  type ApplyInvoiceRefInput,
  clientPaymentCreateSchema,
  clientPaymentUpdateSchema,
  EXPENSE_CATEGORIES,
  holidaySchema,
  terminTemplateSchema,
  type ClientPaymentUpdateInput,
} from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody } from '../common/zod';
import { rate, s } from '../common/decimal';
import { ClientPaymentsService } from './client-payments.service';
import { ExpenseSupportService } from './expense-support.service';
import { RealizationService } from './realization.service';

@ApiTags('realisasi')
@ApiCookieAuth()
@Controller()
export class RealizationController {
  constructor(
    private readonly realization: RealizationService,
    private readonly payments: ClientPaymentsService,
    private readonly support: ExpenseSupportService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('clusters/:id/realization')
  cluster(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.realization.cluster(user, id);
  }

  @Get('projects/:id/realization')
  project(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.realization.project(user, id);
  }

  @Get('projects/:id/reconciliation')
  reconciliation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.realization.reconciliation(user, id);
  }

  // ------------------------------------------------------------ termin klien

  @Get('clusters/:id/client-payments')
  listPayments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.list(user, id);
  }

  @Post('clusters/:id/client-payments')
  @Roles('ADMIN', 'FINANCE')
  @ApiZodBody(clientPaymentCreateSchema)
  createPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(clientPaymentCreateSchema) body: z.infer<typeof clientPaymentCreateSchema>) {
    return this.payments.create(user, id, body);
  }

  @Post('clusters/:id/client-payments/generate')
  @HttpCode(200)
  @Roles('ADMIN', 'FINANCE')
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.generate(user, id);
  }

  /** Preview diff hitung ulang termin (nilai PO berubah). */
  @Get('clusters/:id/client-payments/recalculate')
  recalcPreview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.recalculate(user, id, false);
  }

  /** Terapkan hitung ulang: INVOICED/PAID tetap, selisih ke termin UNBILLED terakhir. */
  @Post('clusters/:id/client-payments/recalculate')
  @HttpCode(200)
  @Roles('ADMIN', 'FINANCE')
  recalcApply(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.recalculate(user, id, true);
  }

  @Patch('client-payments/:id')
  @Roles('ADMIN', 'FINANCE')
  @ApiZodBody(clientPaymentUpdateSchema)
  updatePayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(clientPaymentUpdateSchema) body: ClientPaymentUpdateInput) {
    return this.payments.update(user, id, body);
  }

  /** Terapkan referensi tagihan RAB ke termin (konfirmasi FINANCE; tidak pernah otomatis). */
  @Post('client-payments/:id/apply-reference')
  @Roles('ADMIN', 'FINANCE')
  @ApiZodBody(applyInvoiceRefSchema)
  applyReference(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(applyInvoiceRefSchema) body: ApplyInvoiceRefInput) {
    return this.payments.applyReference(user, id, body);
  }

  @Delete('client-payments/:id')
  @Roles('ADMIN', 'FINANCE')
  removePayment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.remove(user, id);
  }

  // ------------------------------------------------------------ pengaturan realisasi

  @Get('category-mappings')
  async mappings(@Query('projectId') projectId?: string) {
    const map = await this.support.categoryMap(projectId || null);
    return EXPENSE_CATEGORIES.map((category) => ({ category, budgetCode: map[category] ?? null }));
  }

  /** Mapping global (ADMIN). */
  @Put('category-mappings')
  @Roles('ADMIN')
  @ApiZodBody(categoryMappingSchema)
  async setMappings(@CurrentUser() user: AuthUser, @ZBody(categoryMappingSchema) body: z.infer<typeof categoryMappingSchema>) {
    await this.prisma.$transaction(async (tx) => {
      for (const m of body) {
        const before = await tx.categoryMapping.findFirst({ where: { projectId: null, category: m.category } });
        if (before) await tx.categoryMapping.update({ where: { id: before.id }, data: { budgetCode: m.budgetCode } });
        else await tx.categoryMapping.create({ data: { projectId: null, category: m.category, budgetCode: m.budgetCode } });
        await this.audit.diff(tx, user.id, 'CategoryMapping', m.category, { budgetCode: before?.budgetCode ?? null }, { budgetCode: m.budgetCode });
      }
    });
    return this.mappings();
  }

  @Get('termin-templates')
  async templates() {
    const rows = await this.prisma.terminTemplate.findMany({ include: { lines: { orderBy: { terminKe: 'asc' } }, client: true }, orderBy: [{ clientId: 'asc' }, { kind: 'asc' }] });
    return rows.map((t) => ({
      id: t.id,
      client: { id: t.client.id, name: t.client.name },
      kind: t.kind,
      agingDays: t.agingDays,
      agingType: t.agingType,
      lines: t.lines.map((l) => ({ terminKe: l.terminKe, pct: s(l.pct), keterangan: l.keterangan })),
    }));
  }

  /** Buat/ganti template termin client (ADMIN). Tidak mengubah termin cluster yang sudah ada. */
  @Put('termin-templates')
  @Roles('ADMIN')
  @ApiZodBody(terminTemplateSchema)
  async setTemplate(@CurrentUser() user: AuthUser, @ZBody(terminTemplateSchema) body: z.infer<typeof terminTemplateSchema>) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.terminTemplate.findUnique({ where: { clientId_kind: { clientId: body.clientId, kind: body.kind } }, include: { lines: true } });
      const t = before
        ? await tx.terminTemplate.update({ where: { id: before.id }, data: { agingDays: body.agingDays, agingType: body.agingType } })
        : await tx.terminTemplate.create({ data: { clientId: body.clientId, kind: body.kind, agingDays: body.agingDays, agingType: body.agingType } });
      await tx.terminTemplateLine.deleteMany({ where: { templateId: t.id } });
      await tx.terminTemplateLine.createMany({ data: body.lines.map((l, i) => ({ templateId: t.id, terminKe: i + 1, pct: rate(l.pct), keterangan: l.keterangan ?? null })) });
      const fmt = (ls: { pct: { toString(): string } }[]) => ls.map((l) => l.pct.toString()).join('/');
      await this.audit.diff(
        tx,
        user.id,
        'TerminTemplate',
        t.id,
        before ? { lines: fmt(before.lines), agingDays: before.agingDays, agingType: before.agingType } : null,
        { lines: fmt(body.lines), agingDays: body.agingDays, agingType: body.agingType },
      );
    });
    return this.templates();
  }

  @Get('holidays')
  async holidays() {
    const rows = await this.prisma.hariLibur.findMany({ orderBy: { date: 'asc' } });
    return rows.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name }));
  }

  @Post('holidays')
  @Roles('ADMIN')
  @ApiZodBody(holidaySchema)
  async addHoliday(@CurrentUser() user: AuthUser, @ZBody(holidaySchema) body: z.infer<typeof holidaySchema>) {
    const h = await this.prisma.hariLibur.upsert({
      where: { date: new Date(`${body.date}T00:00:00Z`) },
      create: { date: new Date(`${body.date}T00:00:00Z`), name: body.name },
      update: { name: body.name },
    });
    await this.audit.diff(this.prisma, user.id, 'HariLibur', h.id, null, { date: body.date, name: body.name });
    return this.holidays();
  }

  @Delete('holidays/:id')
  @Roles('ADMIN')
  async removeHoliday(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const h = await this.prisma.hariLibur.delete({ where: { id } });
    await this.audit.diff(this.prisma, user.id, 'HariLibur', id, { date: h.date.toISOString().slice(0, 10), name: h.name }, { date: null, name: null });
    return this.holidays();
  }
}
