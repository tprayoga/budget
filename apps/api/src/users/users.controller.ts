import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { userCreateSchema } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody } from '../common/zod';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        jabatan: true,
        active: true,
        memberships: { select: { projectId: true } },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  @Post()
  @ApiZodBody(userCreateSchema)
  async create(@CurrentUser() admin: AuthUser, @ZBody(userCreateSchema) body: z.infer<typeof userCreateSchema>) {
    const u = await this.prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        role: body.role,
        jabatan: body.jabatan ?? null,
        passwordHash: await bcrypt.hash(body.password, 10),
        memberships: { create: (body.projectIds ?? []).map((projectId) => ({ projectId })) },
      },
    });
    await this.audit.diff(this.prisma, admin.id, 'User', u.id, null, { email: u.email, role: u.role });
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  }
}
