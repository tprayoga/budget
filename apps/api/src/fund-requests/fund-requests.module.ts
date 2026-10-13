import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { FundRequestsController } from './fund-requests.controller';
import { FundRequestsService } from './fund-requests.service';

@Module({
  imports: [PdfModule],
  controllers: [FundRequestsController],
  providers: [FundRequestsService],
  exports: [FundRequestsService],
})
export class FundRequestsModule {}
