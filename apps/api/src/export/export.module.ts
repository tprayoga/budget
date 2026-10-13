import { Module } from '@nestjs/common';
import { FundRequestsModule } from '../fund-requests/fund-requests.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({ imports: [FundRequestsModule], controllers: [ExportController], providers: [ExportService] })
export class ExportModule {}
