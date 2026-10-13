import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { frListQuerySchema, todayJakartaIso } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ZQuery } from '../common/zod';
import { ExportService } from './export.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function send(res: Response, buf: Buffer, name: string) {
  res.set({
    'Content-Type': XLSX,
    'Content-Disposition': `attachment; filename="${name}"`,
    'Content-Length': String(buf.length),
  });
  res.end(buf);
}

@ApiTags('export')
@ApiCookieAuth()
@Controller('export')
export class ExportController {
  constructor(
    private readonly exporter: ExportService,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get('projects/:id/budget.xlsx')
  async projectBudget(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const p = await this.access.assertProject(user, id);
    send(res, await this.exporter.budgetWorkbook(user, [id]), `Budget_${p.code}_${todayJakartaIso()}.xlsx`);
  }

  @Get('budget.xlsx')
  async allBudget(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const projects = await this.prisma.project.findMany({
      where: this.access.projectWhere(user),
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    send(res, await this.exporter.budgetWorkbook(user, projects.map((p) => p.id)), `Budget_Per_Cluster_${todayJakartaIso()}.xlsx`);
  }

  @Get('fund-requests.xlsx')
  async fundRequests(
    @CurrentUser() user: AuthUser,
    @ZQuery(frListQuerySchema) q: z.infer<typeof frListQuerySchema>,
    @Res() res: Response,
  ) {
    send(res, await this.exporter.fundRequestsWorkbook(user, q), `Pengajuan_Dana_${todayJakartaIso()}.xlsx`);
  }
}
