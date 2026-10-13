import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  attachmentKindSchema,
  frCreateSchema,
  frDecisionSchema,
  frDisburseSchema,
  frListQuerySchema,
  frRejectSchema,
  frSubmitSchema,
  frUpdateSchema,
  type FrCreateInput,
  type FrUpdateInput,
} from '@indotek/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody, ZQuery } from '../common/zod';
import { FundRequestsService } from './fund-requests.service';
import { MAX_UPLOAD_BYTES, type UploadedFile } from './storage.service';
import { PdfService } from '../pdf/pdf.service';

const upload = FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } });

const attachmentCreateSchema = z.object({
  kind: attachmentKindSchema,
  label: z.string().trim().max(200).nullish(),
  checked: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
const attachmentUpdateSchema = z.object({
  checked: z.boolean().optional(),
  label: z.string().trim().max(200).nullish(),
});

@ApiTags('fund-requests')
@ApiCookieAuth()
@Controller('fund-requests')
export class FundRequestsController {
  constructor(
    private readonly frs: FundRequestsService,
    private readonly pdf: PdfService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(frListQuerySchema) q: z.infer<typeof frListQuerySchema>) {
    return this.frs.list(user, q);
  }

  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser) {
    return this.frs.inbox(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.frs.get(user, id);
  }

  @Post()
  @Roles('PM', 'ADMIN')
  @ApiZodBody(frCreateSchema)
  create(@CurrentUser() user: AuthUser, @ZBody(frCreateSchema) body: FrCreateInput) {
    return this.frs.create(user, body);
  }

  @Patch(':id')
  @Roles('PM', 'ADMIN')
  @ApiZodBody(frUpdateSchema)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(frUpdateSchema) body: FrUpdateInput) {
    return this.frs.update(user, id, body);
  }

  @Delete(':id')
  @Roles('PM', 'ADMIN')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.frs.remove(user, id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Roles('PM', 'ADMIN')
  @ApiZodBody(frSubmitSchema)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(frSubmitSchema) body: z.infer<typeof frSubmitSchema>) {
    return this.frs.submit(user, id, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('FINANCE', 'DIREKTUR', 'INVESTOR')
  @ApiZodBody(frDecisionSchema)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(frDecisionSchema) body: { note?: string | null }) {
    return this.frs.approve(user, id, body.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('FINANCE', 'DIREKTUR', 'INVESTOR')
  @ApiZodBody(frRejectSchema)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(frRejectSchema) body: { note: string }) {
    return this.frs.reject(user, id, body.note);
  }

  @Post(':id/revise')
  @HttpCode(200)
  @Roles('PM', 'ADMIN')
  revise(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.frs.revise(user, id);
  }

  /** multipart: cairTanggal (YYYY-MM-DD), note?, file (bukti transfer). */
  @Post(':id/disburse')
  @HttpCode(200)
  @Roles('FINANCE')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  disburse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(frDisburseSchema) body: z.infer<typeof frDisburseSchema>,
    @UploadedFileParam() file?: UploadedFile,
  ) {
    return this.frs.disburse(user, id, body, file);
  }

  @Get(':id/pdf')
  async pdfFile(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const detail = await this.frs.detailForPdf(user, id);
    const buf = await this.pdf.fundRequestPdf(detail);
    const name = detail.label.replace(/[^\w-]+/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}.pdf"`,
      'Content-Length': String(buf.length),
    });
    res.end(buf);
  }

  /** multipart: kind, label?, checked?, file? (lampiran boleh hanya dicentang tanpa file). */
  @Post(':id/attachments')
  @Roles('PM', 'ADMIN')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  addAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(attachmentCreateSchema) body: z.infer<typeof attachmentCreateSchema>,
    @UploadedFileParam() file?: UploadedFile,
  ) {
    return this.frs.addAttachment(user, id, body, file);
  }

  @Patch(':id/attachments/:attId')
  @Roles('PM', 'ADMIN')
  @ApiZodBody(attachmentUpdateSchema)
  updateAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('attId') attId: string,
    @ZBody(attachmentUpdateSchema) body: z.infer<typeof attachmentUpdateSchema>,
  ) {
    return this.frs.updateAttachment(user, id, attId, body);
  }

  @Delete(':id/attachments/:attId')
  @Roles('PM', 'ADMIN')
  removeAttachment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('attId') attId: string) {
    return this.frs.removeAttachment(user, id, attId);
  }

  @Get(':id/attachments/:attId/file')
  async attachmentFile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('attId') attId: string,
    @Res() res: Response,
  ) {
    const f = await this.frs.attachmentFile(user, id, attId);
    res.setHeader('Content-Type', f.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.fileName)}"`);
    res.sendFile(f.path);
  }
}
