import { Global, Module } from '@nestjs/common';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';

@Global()
@Module({ controllers: [BudgetController], providers: [BudgetService], exports: [BudgetService] })
export class BudgetModule {}
