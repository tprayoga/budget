import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UploadedFile as UploadedFileParam, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  expenseCreateSchema,
  expenseLinkSchema,
  expenseListQuerySchema,
  expenseRejectSchema,
  expenseUpdateSchema,
  type ExpenseCreateInput,
  type ExpenseUpdateInput,
} from '@indotek/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody, ZodPipe, ZQuery } from '../common/zod';
import { MAX_UPLOAD_BYTES, type UploadedFile } from '../storage/storage.service';
import { EXPENSE_WRITE_ROLES, ExpensesService } from './expenses.service';

const upload = FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } });

/** Multipart mengirim semua field sebagai string; field array/objek dikirim sebagai JSON string. */
function fromMultipart(body: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...body };
  for (const k of ['clusterIds', 'manualAllocations']) {
    if (typeof out[k] === 'string') out[k] = JSON.parse(out[k] as string);
  }
  for (const k of Object.keys(out)) if (out[k] === '') out[k] = null;
  return out;
}

@ApiTags('realisasi')
@ApiCookieAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(expenseListQuerySchema) q: z.infer<typeof expenseListQuerySchema>) {
    return this.expenses.list(user, q);
  }

  @Get('pending-count')
  async pending(@CurrentUser() user: AuthUser) {
    return { count: await this.expenses.pendingCount(user) };
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.expenses.get(user, id);
  }

  /** JSON atau multipart (field `file` = foto nota yang sudah dikompres di browser). */
  @Post()
  @Roles(...EXPENSE_WRITE_ROLES)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiZodBody(expenseCreateSchema)
  @UseInterceptors(upload)
  create(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @ZBody(z.any()) raw: Record<string, unknown>,
    @UploadedFileParam() file?: UploadedFile,
  ) {
    const body = req.is('multipart/form-data') ? fromMultipart(raw) : raw;
    const input = new ZodPipe(expenseCreateSchema).transform(body) as ExpenseCreateInput;
    return this.expenses.create(user, input, file);
  }

  @Patch(':id')
  @Roles(...EXPENSE_WRITE_ROLES)
  @ApiZodBody(expenseUpdateSchema)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(expenseUpdateSchema) body: ExpenseUpdateInput) {
    return this.expenses.update(user, id, body);
  }

  @Post(':id/fund-request')
  @HttpCode(200)
  @Roles(...EXPENSE_WRITE_ROLES)
  @ApiZodBody(expenseLinkSchema)
  link(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(expenseLinkSchema) body: { fundRequestId: string | null }) {
    return this.expenses.update(user, id, { fundRequestId: body.fundRequestId });
  }

  @Post(':id/verify')
  @HttpCode(200)
  @Roles('FINANCE')
  verify(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.expenses.verify(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('FINANCE')
  @ApiZodBody(expenseRejectSchema)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(expenseRejectSchema) body: { note: string }) {
    return this.expenses.reject(user, id, body.note);
  }

  @Delete(':id')
  @Roles(...EXPENSE_WRITE_ROLES)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.expenses.remove(user, id);
  }

  @Post(':id/attachment')
  @HttpCode(200)
  @Roles(...EXPENSE_WRITE_ROLES)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  attach(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFileParam() file?: UploadedFile) {
    if (!file) throw new BadRequestException('File wajib diunggah');
    return this.expenses.setAttachment(user, id, file);
  }

  @Get(':id/attachment')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const f = await this.expenses.attachmentFile(user, id);
    res.setHeader('Content-Type', f.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.fileName)}"`);
    res.sendFile(f.path);
  }
}
