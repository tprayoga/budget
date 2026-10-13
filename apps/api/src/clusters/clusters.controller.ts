import { Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  budgetLineSchema,
  clusterCreateSchema,
  clusterDuplicateSchema,
  clusterUpdateSchema,
  clusterPoSchema,
  clusterPoUpdateSchema,
  type ClusterPoInput,
  type ClusterPoUpdateInput,
  type BudgetLineDto,
  type ClusterCreateInput,
  type ClusterUpdateInput,
} from '@indotek/shared';
import { CurrentUser, EDITOR_ROLES, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody } from '../common/zod';
import { ClustersService } from './clusters.service';
import { ClusterPosService } from './cluster-pos.service';

const linesSchema = z.array(budgetLineSchema);

@ApiTags('clusters')
@ApiCookieAuth()
@Controller('clusters')
export class ClustersController {
  constructor(
    private readonly clusters: ClustersService,
    private readonly pos: ClusterPosService,
  ) {}

  @Get(':id/pos')
  listPos(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pos.list(user, id);
  }

  @Post(':id/pos')
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(clusterPoSchema)
  createPo(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(clusterPoSchema) body: ClusterPoInput) {
    return this.pos.create(user, id, body);
  }

  @Patch('pos/:poId')
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(clusterPoUpdateSchema)
  updatePo(@CurrentUser() user: AuthUser, @Param('poId') poId: string, @ZBody(clusterPoUpdateSchema) body: ClusterPoUpdateInput) {
    return this.pos.update(user, poId, body);
  }

  @Delete('pos/:poId')
  @Roles(...EDITOR_ROLES)
  removePo(@CurrentUser() user: AuthUser, @Param('poId') poId: string) {
    return this.pos.remove(user, poId);
  }

  @Get()
  @ApiQuery({ name: 'projectId', required: false })
  list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.clusters.list(user, projectId || undefined);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.clusters.get(user, id);
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(clusterCreateSchema)
  create(@CurrentUser() user: AuthUser, @ZBody(clusterCreateSchema) body: ClusterCreateInput) {
    return this.clusters.create(user, body);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(clusterUpdateSchema)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(clusterUpdateSchema) body: ClusterUpdateInput) {
    return this.clusters.update(user, id, body);
  }

  @Get(':id/budget-lines')
  async lines(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return (await this.clusters.get(user, id)).lines;
  }

  /** Upsert satu/lebih baris budget (mode PCT/RP). */
  @Put(':id/budget-lines')
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(linesSchema)
  updateLines(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(linesSchema) body: BudgetLineDto[]) {
    return this.clusters.updateLines(user, id, body);
  }

  @Post(':id/duplicate')
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(clusterDuplicateSchema)
  duplicate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(clusterDuplicateSchema) body: { name: string },
  ) {
    return this.clusters.duplicate(user, id, body.name);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.clusters.remove(user, id);
  }
}
