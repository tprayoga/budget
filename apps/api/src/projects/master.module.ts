import { Module } from '@nestjs/common';
import { ClientsController } from '../clients/clients.controller';
import { UsersController } from '../users/users.controller';
import { ProjectsController } from './projects.controller';

@Module({ controllers: [ClientsController, ProjectsController, UsersController] })
export class MasterModule {}
