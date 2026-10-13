import {
  BadRequestException,
  ForbiddenException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { CurrentUser, EDITOR_ROLES, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { BudgetImporter, type ImportForce } from './budget-importer';
import { LedgerImporter } from './ledger-importer';
import { RabImporter } from './rab-importer';
import { PoAdjustImporter } from './po-adjust-importer';
import { ExpenseSupportService } from '../realization/expense-support.service';
import { heldDismissSchema, heldReleaseSchema, rabCommitSchema, type HeldReleaseInput } from '@indotek/shared';
import { HeldItemsService } from './held-items.service';
import { ApiZodBody, ZBody } from '../common/zod';
import { z } from 'zod';
import { AccessService } from '../access/access.service';

@ApiTags('import')
@ApiCookieAuth()
@Controller('import')
export class ImportController {
  private readonly importer: BudgetImporter;
  private readonly rab: RabImporter;
  private readonly ledger: LedgerImporter;
  private readonly poAdjust: PoAdjustImporter;

  constructor(
    private readonly prisma: PrismaService,
    audit: AuditService,
    settings: SettingsService,
    support: ExpenseSupportService,
    private readonly access: AccessService,
    private readonly held: HeldItemsService,
  ) {
    this.importer = new BudgetImporter(prisma, audit, settings);
    this.rab = new RabImporter(prisma, audit, support);
    this.ledger = new LedgerImporter(prisma, audit);
    this.poAdjust = new PoAdjustImporter(prisma, audit);
  }

  /**
   * Import budget per cluster dari Excel. mode=dry-run (default) → preview + diff;
   * mode=commit → simpan cluster NEW/CHANGED (field `keys` opsional: JSON array / dipisah koma).
   */
  @Post('budget-xlsx')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'mode', enum: ['dry-run', 'commit'], required: false })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async budgetXlsx(
    @CurrentUser() user: AuthUser,
    @Query('mode') mode = 'dry-run',
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
    @Body('keys') keysRaw?: string,
    @Body('force') forceRaw?: string,
    @Body('reason') reason?: string,
  ) {
    if (!file) throw new BadRequestException('File .xlsx wajib diunggah (field "file")');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Hanya file .xlsx');
    let parsed;
    try {
      parsed = await this.importer.parse(file.buffer);
    } catch {
      throw new BadRequestException('File tidak bisa dibaca sebagai Excel .xlsx');
    }
    if (!parsed.projects.length) {
      throw new BadRequestException('Tidak ada sheet project dengan layout budget (A4 = "Nilai PO Implementasi")');
    }
    if (mode === 'commit') {
      const keys = this.parseKeys(keysRaw);
      const force = this.parseForce(user, forceRaw, reason);
      return { mode, ...(await this.importer.commit(parsed, user.id, keys, undefined, force)) };
    }
    return { mode: 'dry-run', ...(await this.importer.preview(parsed)) };
  }

  /** Penimpaan field dilindungi: hanya ADMIN, wajib alasan. Format: {"PROJECT::Cluster": ["nilaiPoImpl", ...]} */
  private parseForce(user: AuthUser, raw?: string, reason?: string): ImportForce | undefined {
    if (!raw) return undefined;
    let fields: Record<string, string[]>;
    try {
      fields = z.record(z.array(z.string())).parse(JSON.parse(raw));
    } catch {
      throw new BadRequestException('Field force tidak valid');
    }
    if (!Object.values(fields).some((f) => f.length)) return undefined;
    if (user.role !== 'ADMIN') throw new ForbiddenException('Hanya ADMIN yang boleh menimpa field yang dilindungi');
    if (!reason?.trim()) throw new BadRequestException('Alasan penimpaan wajib diisi');
    return { fields, reason: reason.trim() };
  }

  private async parseRab(file?: { buffer: Buffer; originalname: string }) {
    if (!file) throw new BadRequestException('File .xlsx wajib diunggah (field "file")');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Hanya file .xlsx');
    try {
      return await this.rab.parse(file.buffer);
    } catch {
      throw new BadRequestException('File tidak bisa dibaca sebagai Excel .xlsx');
    }
  }

  /**
   * Import realisasi dari file RAB. mode=dry-run → preview (NEW/CHANGED/UNCHANGED/NEEDS_MAPPING/SKIPPED, peringatan,
   * total sheet, tagihan klien sebagai referensi). mode=commit + field `decisions` (JSON:
   * { [mappingKey|sourceRef]: { scope: CLUSTER|PROJECT|SKIP, clusterId?, clusterIds?, method?, category? } }).
   */
  @Post('rab-xlsx')
  @HttpCode(200)
  @Roles('ADMIN', 'FINANCE')
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'mode', enum: ['dry-run', 'commit'], required: false })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async rabXlsx(
    @CurrentUser() user: AuthUser,
    @Query('mode') mode = 'dry-run',
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
    @Body('decisions') decisionsRaw?: string,
  ) {
    const parsed = await this.parseRab(file);
    if (!parsed.projects.length) throw new BadRequestException('Tidak ada sheet project (ADW/EVANTAMA/CCSI) di file');
    if (mode === 'commit') {
      let decisions = {};
      if (decisionsRaw) {
        try {
          decisions = rabCommitSchema.parse({ decisions: JSON.parse(decisionsRaw) }).decisions ?? {};
        } catch {
          throw new BadRequestException('Field decisions tidak valid');
        }
      }
      return { mode, ...(await this.rab.commit(parsed, decisions, user.id)) };
    }
    return { mode: 'dry-run', ...(await this.rab.preview(parsed)) };
  }

  /**
   * Import penyesuaian PO (baris "Deduction Termin 1 + Addwork" di file RAB) → PO ADDWORK/DEDUCTION per cluster.
   * mode=dry-run → preview (nilai PO implementasi sekarang → sesudah); mode=commit → simpan.
   */
  @Post('po-adjustments-xlsx')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'mode', enum: ['dry-run', 'commit'], required: false })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async poAdjustments(@CurrentUser() user: AuthUser, @Query('mode') mode = 'dry-run', @UploadedFile() file?: { buffer: Buffer; originalname: string }) {
    const parsed = await this.parseRab(file);
    if (!parsed.projects.some((p) => p.poAdjustments.length)) throw new BadRequestException('Baris "Deduction Termin 1 + Addwork" tidak ditemukan di file');
    if (mode === 'commit') return { mode, ...(await this.poAdjust.commit(parsed, user.id)) };
    return { mode: 'dry-run', ...(await this.poAdjust.preview(parsed)) };
  }

  /** Import buku kas (sheet dengan header Date/Description/Project/Cash In/Cash Out, mis. TELCO - OPS). */
  @Post('cash-ledger-xlsx')
  @HttpCode(200)
  @Roles('ADMIN', 'FINANCE')
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'mode', enum: ['dry-run', 'commit'], required: false })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async cashLedger(@CurrentUser() user: AuthUser, @Query('mode') mode = 'dry-run', @UploadedFile() file?: { buffer: Buffer; originalname: string }) {
    const parsed = await this.parseRab(file);
    if (!parsed.ledger.length) throw new BadRequestException('Sheet buku kas (Date/Description/Project/Cash In/Cash Out) tidak ditemukan');
    if (mode === 'commit') return { mode, sheet: parsed.ledgerSheet, ...(await this.ledger.commit(parsed.ledger, user.id)) };
    const p = await this.ledger.preview(parsed.ledger);
    return { mode: 'dry-run', sheet: parsed.ledgerSheet, summary: p.summary, projectLabels: p.projectLabels, sample: p.items.slice(0, 50) };
  }

  /** Daftar "Ditahan — perlu konfirmasi" (status HELD; RELEASED/DISMISSED untuk riwayat). */
  @Get('held')
  heldList(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.held.list(user, status || 'HELD');
  }

  @Post('held/:id/release')
  @HttpCode(200)
  @Roles('ADMIN', 'FINANCE')
  @ApiZodBody(heldReleaseSchema)
  release(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(heldReleaseSchema) body: HeldReleaseInput) {
    return this.held.release(user, id, body);
  }

  @Post('held/:id/reopen')
  @HttpCode(200)
  @Roles('ADMIN', 'FINANCE')
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.held.reopen(user, id);
  }

  @Post('held/:id/dismiss')
  @HttpCode(200)
  @Roles('ADMIN', 'FINANCE')
  @ApiZodBody(heldDismissSchema)
  dismiss(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(heldDismissSchema) body: z.infer<typeof heldDismissSchema>) {
    return this.held.dismiss(user, id, body);
  }

  /** Buku kas: referensi saja (tidak dihitung sebagai realisasi). */
  @Get('/cash-ledger')
  async listLedger(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    if (projectId) await this.access.assertProject(user, projectId);
    const restricted = this.access.isRestricted(user);
    const rows = await this.prisma.cashLedger.findMany({
      where: {
        ...(projectId ? { projectId } : restricted ? { project: this.access.projectWhere(user) } : {}),
        ...(from || to ? { date: { gte: from ? new Date(`${from}T00:00:00Z`) : undefined, lte: to ? new Date(`${to}T00:00:00Z`) : undefined } } : {}),
        ...(q ? { description: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ date: 'asc' }, { sourceRow: 'asc' }],
      take: 2000,
      include: { project: { select: { code: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      description: r.description,
      project: r.project?.code ?? null,
      projectLabel: r.projectLabel,
      cashAccount: r.cashAccount,
      accountName: r.accountName,
      cashIn: r.cashIn.toString(),
      cashOut: r.cashOut.toString(),
    }));
  }

  private parseKeys(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map(String);
    } catch {
      /* bukan JSON → pisah koma */
    }
    return raw.split(',').map((x) => x.trim()).filter(Boolean);
  }
}
