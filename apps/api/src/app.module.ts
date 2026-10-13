import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessModule } from './access/access.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BudgetModule } from './budget/budget.module';
import { ClustersModule } from './clusters/clusters.module';
import { ExportModule } from './export/export.module';
import { FundRequestsModule } from './fund-requests/fund-requests.module';
import { ImportModule } from './import/import.module';
import { PrismaModule } from './prisma/prisma.module';
import { MasterModule } from './projects/master.module';
import { SettingsModule } from './settings/settings.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    PrismaModule,
    AuditModule,
    AccessModule,
    AuthModule,
    SettingsModule,
    BudgetModule,
    MasterModule,
    ClustersModule,
    FundRequestsModule,
    ImportModule,
    ExportModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
