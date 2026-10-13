import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { FundRequestsController } from './fund-requests.controller';
import { FundRequestsService } from './fund-requests.service';
import { StorageService } from './storage.service';

@Module({
  imports: [PdfModule],
  controllers: [FundRequestsController],
  providers: [FundRequestsService, StorageService],
  exports: [FundRequestsService],
})
export class FundRequestsModule {}
