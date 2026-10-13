import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
  UnprocessableEntityException,
  UploadedFile as UploadedFileParam,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { ExpenseCategory } from '@prisma/client';
import type { Request } from 'express';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, webhookExpenseSchema, type WebhookExpenseInput } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Public, SkipCsrf } from '../auth/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { money } from '../common/decimal';
import { MAX_UPLOAD_BYTES, StorageService, type UploadedFile } from '../storage/storage.service';
import { ApiKeyGuard, type ApiKeyContext } from './api-keys';
import { ExpenseSupportService } from './expense-support.service';
import { flatExpense } from './expenses.service';

/** Kategori dari teks bot: kode enum ("OPS", "sewa motor" → MOTOR_MOBIL tidak ditebak) atau label persis. */
export function parseCategory(raw: string): ExpenseCategory | null {
  const norm = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((EXPENSE_CATEGORIES as readonly string[]).includes(norm)) return norm as ExpenseCategory;
  const byLabel = Object.entries(EXPENSE_CATEGORY_LABEL).find(([, l]) => l.toLowerCase() === raw.trim().toLowerCase());
  return (byLabel?.[0] as ExpenseCategory) ?? null;
}

const IMAGE_SIG: [string, number[]][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],
];

function decodeBase64Image(data: string, name?: string | null): UploadedFile {
  const m = data.match(/^data:([\w/+.-]+);base64,(.*)$/s);
  const buffer = Buffer.from(m ? m[2] : data, 'base64');
  const sig = IMAGE_SIG.find(([, bytes]) => bytes.every((b, i) => buffer[i] === b));
  if (!sig) throw new BadRequestException('fotoBase64 harus gambar JPEG/PNG/WebP');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new BadRequestException('Foto maksimal 10 MB');
  const ext = sig[0].split('/')[1].replace('jpeg', 'jpg');
  return { originalname: name || `nota.${ext}`, mimetype: sig[0], size: buffer.length, buffer };
}

/**
 * Webhook untuk bot Telegram / n8n: POST /api/webhooks/expenses dengan header X-API-Key.
 * Body JSON atau multipart: { cluster (id atau nama persis), kategori, nominal, tanggal, keterangan?, externalId?,
 * foto (file) / fotoBase64 }. Hasil selalu PERLU_VERIFIKASI dan baru dihitung setelah diverifikasi FINANCE.
 */
@ApiTags('webhook')
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly support: ExpenseSupportService,
  ) {}

  @Public()
  @SkipCsrf()
  @UseGuards(ApiKeyGuard)
  @Post('expenses')
  @HttpCode(201)
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiZodBody(webhookExpenseSchema)
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async create(
    @Req() req: Request & { apiKey: ApiKeyContext },
    @ZBody(webhookExpenseSchema) body: WebhookExpenseInput,
    @UploadedFileParam() file?: UploadedFile,
  ) {
    const apiKey = req.apiKey;
    const sourceRef = body.externalId ? `WEBHOOK:${apiKey.id}:${body.externalId}` : null;
    if (sourceRef) {
      const dup = await this.prisma.expense.findUnique({ where: { sourceRef } });
      if (dup) return { id: dup.id, status: dup.status, duplicate: true };
    }

    const name = body.cluster.trim();
    const clusters = await this.prisma.cluster.findMany({
      where: { OR: [{ id: name }, { name: { equals: name, mode: 'insensitive' } }] },
      include: { project: { select: { code: true } } },
    });
    if (clusters.length !== 1) {
      throw new UnprocessableEntityException({
        message: clusters.length ? 'Nama cluster ambigu — kirim id cluster' : 'Cluster tidak ditemukan (pakai id atau nama persis)',
        code: 'CLUSTER',
        candidates: clusters.map((c) => ({ id: c.id, name: c.name, project: c.project.code })),
      });
    }
    const cluster = clusters[0];
    const category = parseCategory(body.kategori);
    if (!category) {
      throw new UnprocessableEntityException({ message: 'Kategori tidak dikenal', code: 'KATEGORI', allowed: EXPENSE_CATEGORIES });
    }
    const foto = file ?? (body.fotoBase64 ? decodeBase64Image(body.fotoBase64, body.fotoNama) : undefined);

    const id = await this.prisma.$transaction(async (tx) => {
      let budgetCode;
      try {
        budgetCode = await this.support.resolveBudgetCode(cluster.projectId, category, null, tx);
      } catch {
        throw new UnprocessableEntityException({ message: `Kategori ${category} tidak bisa dipakai lewat webhook (pos budget harus dipilih manual)`, code: 'KATEGORI' });
      }
      const e = await tx.expense.create({
        data: {
          projectId: cluster.projectId,
          clusterId: cluster.id,
          date: new Date(`${body.tanggal}T00:00:00Z`),
          category,
          budgetCode,
          description: body.keterangan?.trim() || `${EXPENSE_CATEGORY_LABEL[category]} (via ${apiKey.name})`,
          amount: money(body.nominal),
          status: 'PERLU_VERIFIKASI',
          source: 'WEBHOOK',
          sourceRef,
          apiKeyId: apiKey.id,
        },
      });
      await this.support.writeAllocations(tx, e.id, [{ clusterId: cluster.id, amount: body.nominal, pct: '1' }]);
      if (foto) {
        const stored = await this.storage.saveIn('expense', e.id, foto);
        await tx.expense.update({ where: { id: e.id }, data: { attachmentUrl: stored.fileUrl, attachmentName: stored.fileName, attachmentMime: stored.mimeType } });
      }
      const after = await tx.expense.findUniqueOrThrow({ where: { id: e.id }, include: { allocations: true } });
      await this.audit.diff(tx, null, 'Expense', e.id, null, { ...flatExpense(after)!, via: `webhook:${apiKey.name}` });
      return e.id;
    });
    return { id, status: 'PERLU_VERIFIKASI', duplicate: false, cluster: { id: cluster.id, name: cluster.name } };
  }
}
