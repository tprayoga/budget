import { Global, Module } from '@nestjs/common';
import { ApiKeyGuard, ApiKeysController } from './api-keys';
import { ClientPaymentsService } from './client-payments.service';
import { ExpenseSupportService } from './expense-support.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { RealizationController } from './realization.controller';
import { RealizationService } from './realization.service';
import { WebhookController } from './webhook.controller';

@Global()
@Module({
  controllers: [ExpensesController, RealizationController, ApiKeysController, WebhookController],
  providers: [ExpenseSupportService, ExpensesService, RealizationService, ClientPaymentsService, ApiKeyGuard],
  exports: [ExpenseSupportService, ExpensesService, RealizationService, ClientPaymentsService],
})
export class RealizationModule {}
