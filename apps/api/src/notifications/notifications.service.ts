import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { NEEDS_INVOICE_DATE_WHERE } from '../realization/client-payments.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, unreadOnly: boolean) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { unread, items };
  }

  async markRead(user: AuthUser, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== user.id) throw new NotFoundException('Notifikasi tidak ditemukan');
    return this.prisma.notification.update({ where: { id }, data: { readAt: n.readAt ?? new Date() } });
  }

  async markAllRead(user: AuthUser) {
    const res = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  /** Termin klien yang tanggal invoice-nya belum diisi (untuk inbox FINANCE). */
  async missingInvoiceDates() {
    const rows = await this.prisma.clientPayment.findMany({
      where: NEEDS_INVOICE_DATE_WHERE,
      include: { cluster: { select: { id: true, name: true, project: { select: { code: true } } } }, po: { select: { poNumber: true } } },
      orderBy: [{ clusterId: 'asc' }, { kind: 'asc' }, { termin: 'asc' }],
    });
    return rows.map((p) => ({
      id: p.id,
      clusterId: p.clusterId,
      clusterName: p.cluster.name,
      projectCode: p.cluster.project.code,
      kind: p.kind,
      termin: p.termin,
      poNumber: p.po?.poNumber ?? null,
      invoiceNo: p.invoiceNo,
      amount: p.amount.toFixed(2),
      status: p.status,
    }));
  }
}
