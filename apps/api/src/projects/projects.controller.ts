import { ConflictException, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { projectSchema, projectUpdateSchema } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { CurrentUser, EDITOR_ROLES, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody } from '../common/zod';

const membersSchema = z.object({ userIds: z.array(z.string()) });

@ApiTags('projects')
@ApiCookieAuth()
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.project.findMany({
      where: this.access.projectWhere(user),
      include: { client: true, _count: { select: { clusters: true } } },
      orderBy: { code: 'asc' },
    });
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertProject(user, id);
    return this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: { client: true, _count: { select: { clusters: true } } },
    });
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(projectSchema)
  async create(@CurrentUser() user: AuthUser, @ZBody(projectSchema) body: z.infer<typeof projectSchema>) {
    const p = await this.prisma.project.create({ data: body });
    await this.audit.diff(this.prisma, user.id, 'Project', p.id, null, body);
    return p;
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(projectUpdateSchema)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(projectUpdateSchema) body: z.infer<typeof projectUpdateSchema>,
  ) {
    const before = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const p = await this.prisma.project.update({ where: { id }, data: body });
    await this.audit.diff(this.prisma, user.id, 'Project', id, before, body);
    return p;
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const used = await this.prisma.cluster.count({ where: { projectId: id } });
    if (used) throw new ConflictException('Project masih memiliki cluster');
    const p = await this.prisma.project.delete({ where: { id } });
    await this.audit.diff(this.prisma, user.id, 'Project', id, { code: p.code }, { code: null });
    return { ok: true };
  }

  @Get(':id/members')
  @Roles('ADMIN')
  members(@Param('id') id: string) {
    return this.prisma.projectMember.findMany({
      where: { projectId: id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
  }

  /** Ganti daftar anggota project (dipakai untuk membatasi akses INVESTOR). */
  @Put(':id/members')
  @Roles('ADMIN')
  @ApiZodBody(membersSchema)
  async setMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(membersSchema) body: z.infer<typeof membersSchema>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.projectMember.findMany({ where: { projectId: id } });
      await tx.projectMember.deleteMany({ where: { projectId: id } });
      await tx.projectMember.createMany({ data: body.userIds.map((userId) => ({ userId, projectId: id })) });
      await this.audit.diff(
        tx,
        user.id,
        'Project',
        id,
        { members: before.map((m) => m.userId).sort().join(',') },
        { members: [...body.userIds].sort().join(',') },
      );
      return tx.projectMember.findMany({ where: { projectId: id } });
    });
  }
}
