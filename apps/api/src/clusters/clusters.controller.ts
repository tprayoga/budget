import { Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  budgetLineSchema,
  clusterCreateSchema,
  clusterDuplicateSchema,
  clusterUpdateSchema,
  type BudgetLineDto,
  type ClusterCreateInput,
  type ClusterUpdateInput,
} from '@indotek/shared';
import { CurrentUser, EDITOR_ROLES, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody } from '../common/zod';
import { ClustersService } from './clusters.service';

const linesSchema = z.array(budgetLineSchema);

@ApiTags('clusters')
@ApiBearerAuth()
@Controller('clusters')
export class ClustersController {
  constructor(private readonly clusters: ClustersService) {}

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
