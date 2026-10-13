import { Module } from '@nestjs/common';
import { ClustersController } from './clusters.controller';
import { ClustersService } from './clusters.service';
import { ClusterPosService } from './cluster-pos.service';

@Module({ controllers: [ClustersController], providers: [ClustersService, ClusterPosService], exports: [ClustersService] })
export class ClustersModule {}
