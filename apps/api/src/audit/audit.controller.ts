import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('ADMIN', 'PM', 'FINANCE', 'DIREKTUR')
  @ApiQuery({ name: 'entity', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  list(@Query('entity') entity?: string, @Query('entityId') entityId?: string) {
    return this.audit.list(entity || undefined, entityId || undefined);
  }
}
