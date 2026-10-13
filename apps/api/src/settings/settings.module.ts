import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { TemplatesService } from './templates.service';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, TemplatesService],
  exports: [SettingsService, TemplatesService],
})
export class SettingsModule {}
