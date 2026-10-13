import { Controller, Delete, Get, Param, Patch, Post, ConflictException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { clientSchema } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, EDITOR_ROLES, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody } from '../common/zod';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.client.findMany({ orderBy: { name: 'asc' } });
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(clientSchema)
  async create(@CurrentUser() user: AuthUser, @ZBody(clientSchema) body: { name: string }) {
    const c = await this.prisma.client.create({ data: body });
    await this.audit.diff(this.prisma, user.id, 'Client', c.id, null, { name: c.name });
    return c;
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(clientSchema)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(clientSchema) body: { name: string }) {
    const before = await this.prisma.client.findUniqueOrThrow({ where: { id } });
    const c = await this.prisma.client.update({ where: { id }, data: body });
    await this.audit.diff(this.prisma, user.id, 'Client', id, { name: before.name }, { name: c.name });
    return c;
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const used = await this.prisma.project.count({ where: { clientId: id } });
    if (used) throw new ConflictException('Client masih dipakai project');
    const c = await this.prisma.client.delete({ where: { id } });
    await this.audit.diff(this.prisma, user.id, 'Client', id, { name: c.name }, { name: null });
    return { ok: true };
  }
}
