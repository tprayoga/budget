import { Controller, Get, Param } from '@nestjs/common';
import { ApiCookieAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { zRate } from '@indotek/shared';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ZQuery } from '../common/zod';
import { BudgetService, type BudgetPreview } from './budget.service';

const previewSchema = z.object({
  interestRate: zRate.optional(),
  retensiAsCost: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

@ApiTags('budget')
@ApiCookieAuth()
@Controller()
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get('projects/:id/budget')
  @ApiQuery({ name: 'interestRate', required: false, description: 'Preview what-if (rasio, mis. 0.1)' })
  @ApiQuery({ name: 'retensiAsCost', required: false, enum: ['true', 'false'] })
  projectBudget(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZQuery(previewSchema) preview: BudgetPreview,
  ) {
    return this.budget.projectBudget(user, id, preview);
  }

  @Get('budget/rekap')
  @ApiQuery({ name: 'interestRate', required: false })
  @ApiQuery({ name: 'retensiAsCost', required: false, enum: ['true', 'false'] })
  rekap(@CurrentUser() user: AuthUser, @ZQuery(previewSchema) preview: BudgetPreview) {
    return this.budget.rekap(user, preview);
  }
}
