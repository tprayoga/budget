import { dec } from '@indotek/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type Val = string | number | boolean | null | undefined | { toString(): string };

function norm(v: Val): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Bandingkan dua nilai; angka desimal dibandingkan secara numerik ("0.10" == "0.1"). */
function same(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const num = /^-?\d+(\.\d+)?$/;
  return num.test(a) && num.test(b) && dec(a).eq(dec(b));
}

export interface AuditEntry {
  entity: string;
  entityId: string;
  field: string;
  oldValue?: Val;
  newValue?: Val;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catat perubahan field (hanya yang berubah). Gunakan `tx` agar ikut transaksi pemanggil. */
  async diff(
    tx: Tx | PrismaService,
    userId: string | null,
    entity: string,
    entityId: string,
    before: Record<string, Val> | null,
    after: Record<string, Val>,
    prefix = '',
  ) {
    const rows = Object.keys(after)
      .map((field) => ({
        field: prefix + field,
        oldValue: before ? norm(before[field]) : null,
        newValue: norm(after[field]),
      }))
      .filter((r) => !same(r.oldValue, r.newValue));
    if (rows.length) {
      await tx.auditLog.createMany({ data: rows.map((r) => ({ ...r, entity, entityId, userId })) });
    }
    return rows.length;
  }

  async log(tx: Tx | PrismaService, userId: string | null, entries: AuditEntry[]) {
    if (!entries.length) return;
    await tx.auditLog.createMany({
      data: entries.map((e) => ({
        entity: e.entity,
        entityId: e.entityId,
        field: e.field,
        oldValue: norm(e.oldValue),
        newValue: norm(e.newValue),
        userId,
      })),
    });
  }

  list(entity?: string, entityId?: string, take = 200) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { at: 'desc' },
      take,
      include: { user: { select: { id: true, name: true, role: true } } },
    });
  }
}
