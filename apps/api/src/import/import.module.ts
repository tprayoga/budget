import { Module } from '@nestjs/common';
import { HeldItemsService } from './held-items.service';
import { ImportController } from './import.controller';

@Module({ controllers: [ImportController], providers: [HeldItemsService] })
export class ImportModule {}
