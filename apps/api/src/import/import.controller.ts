import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { CurrentUser, EDITOR_ROLES, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { BudgetImporter } from './budget-importer';

@ApiTags('import')
@ApiBearerAuth()
@Controller('import')
export class ImportController {
  private readonly importer: BudgetImporter;

  constructor(prisma: PrismaService, audit: AuditService, settings: SettingsService) {
    this.importer = new BudgetImporter(prisma, audit, settings);
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
      return { mode, ...(await this.importer.commit(parsed, user.id, keys)) };
    }
    return { mode: 'dry-run', ...(await this.importer.preview(parsed)) };
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
