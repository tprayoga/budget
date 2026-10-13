import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

/**
 * Akses per project. INVESTOR hanya boleh melihat/approve project yang terdaftar di ProjectMember;
 * role lain melihat semua project.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  isRestricted(user: AuthUser): boolean {
    return user.role === 'INVESTOR';
  }

  /** Filter Prisma untuk model Project. */
  projectWhere(user: AuthUser): Prisma.ProjectWhereInput {
    return this.isRestricted(user) ? { members: { some: { userId: user.id } } } : {};
  }

  clusterWhere(user: AuthUser): Prisma.ClusterWhereInput {
    return this.isRestricted(user) ? { project: this.projectWhere(user) } : {};
  }

  fundRequestWhere(user: AuthUser): Prisma.FundRequestWhereInput {
    return this.isRestricted(user) ? { cluster: this.clusterWhere(user) } : {};
  }

  async assertProject(user: AuthUser, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project tidak ditemukan');
    if (this.isRestricted(user)) {
      const m = await this.prisma.projectMember.findUnique({
        where: { userId_projectId: { userId: user.id, projectId } },
      });
      // 404 agar keberadaan project lain tidak bocor
      if (!m) throw new NotFoundException('Project tidak ditemukan');
    }
    return project;
  }

  async assertCluster(user: AuthUser, clusterId: string) {
    const cluster = await this.prisma.cluster.findUnique({ where: { id: clusterId } });
    if (!cluster) throw new NotFoundException('Cluster tidak ditemukan');
    await this.assertProject(user, cluster.projectId);
    return cluster;
  }

  assertCanAct(user: AuthUser, allowed: boolean, message = 'Anda tidak berwenang') {
    if (!allowed) throw new ForbiddenException(message);
  }
}
