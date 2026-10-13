import { Injectable } from '@nestjs/common';
import type { Setting } from '@prisma/client';
import type { SettingInput } from '@indotek/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { rate, s } from '../common/decimal';

/** Nilai awal baris Setting global (default model Setting sesuai spesifikasi). */
/** Fase 2.3: default resmi retensiAsCost = false (retensi = piutang, bukan biaya). */
export const GLOBAL_DEFAULTS = { interestRate: '0.10', retensiAsCost: false, realisasiWarnPct: '0.8', realisasiOverPct: '1' } as const;

export interface EffectiveSetting {
  interestRate: string;
  retensiAsCost: boolean;
  rekeningBank: string | null;
  rekeningNo: string | null;
  rekeningNama: string | null;
  /** Ambang kuning realisasi (rasio). */
  realisasiWarnPct: string;
  /** Ambang notifikasi over budget (rasio, default 1 = 100%). */
  realisasiOverPct: string;
  /** Field yang di-override di level project. */
  overridden: (keyof SettingInput)[];
}

type SettingField = 'interestRate' | 'retensiAsCost' | 'rekeningBank' | 'rekeningNo' | 'rekeningNama' | 'realisasiWarnPct' | 'realisasiOverPct';

function dto(row: Setting | null) {
  return row
    ? {
        id: row.id,
        projectId: row.projectId,
        interestRate: s(row.interestRate),
        retensiAsCost: row.retensiAsCost,
        rekeningBank: row.rekeningBank,
        rekeningNo: row.rekeningNo,
        rekeningNama: row.rekeningNama,
        realisasiWarnPct: s(row.realisasiWarnPct),
        realisasiOverPct: s(row.realisasiOverPct),
        updatedAt: row.updatedAt,
      }
    : null;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async globalRow(tx: Tx | PrismaService = this.prisma): Promise<Setting> {
    const row = await tx.setting.findFirst({ where: { projectId: null } });
    if (row) return row;
    return tx.setting.create({ data: { projectId: null, ...GLOBAL_DEFAULTS } });
  }

  async getGlobal() {
    return dto(await this.globalRow());
  }

  async getProject(projectId: string) {
    const [own, effective] = await Promise.all([
      this.prisma.setting.findUnique({ where: { projectId } }),
      this.effective(projectId),
    ]);
    return { override: dto(own), effective };
  }

  /** Setting efektif: kolom project yang tidak null meng-override global. */
  async effective(projectId: string | null, tx: Tx | PrismaService = this.prisma): Promise<EffectiveSetting> {
    const global = await this.globalRow(tx);
    const own = projectId ? await tx.setting.findUnique({ where: { projectId } }) : null;
    const overridden: (keyof SettingInput)[] = [];
    const pick = <K extends SettingField>(k: K) => {
      if (own && own[k] !== null && own[k] !== undefined) {
        overridden.push(k);
        return own[k];
      }
      return global[k];
    };
    const interestRate = pick('interestRate');
    const retensiAsCost = pick('retensiAsCost');
    return {
      interestRate: (interestRate ?? GLOBAL_DEFAULTS.interestRate).toString(),
      retensiAsCost: retensiAsCost ?? GLOBAL_DEFAULTS.retensiAsCost,
      rekeningBank: pick('rekeningBank'),
      rekeningNo: pick('rekeningNo'),
      rekeningNama: pick('rekeningNama'),
      realisasiWarnPct: (pick('realisasiWarnPct') ?? GLOBAL_DEFAULTS.realisasiWarnPct).toString(),
      realisasiOverPct: (pick('realisasiOverPct') ?? GLOBAL_DEFAULTS.realisasiOverPct).toString(),
      overridden,
    };
  }

  /** Hanya ADMIN (dijaga di controller). Semua perubahan tercatat di AuditLog. */
  async updateGlobal(userId: string, input: SettingInput) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.globalRow(tx);
      const data = this.toData(input);
      const after = await tx.setting.update({ where: { id: before.id }, data });
      await this.audit.diff(tx, userId, 'Setting', before.id, dto(before), this.pickChanged(dto(after), data));
      return dto(after);
    });
  }

  /** Override per project. Nilai null = kembali ikut global. */
  async updateProject(userId: string, projectId: string, input: SettingInput) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.setting.findUnique({ where: { projectId } });
      const data = this.toData(input);
      const after = before
        ? await tx.setting.update({ where: { id: before.id }, data })
        : await tx.setting.create({ data: { ...data, projectId } });
      await this.audit.diff(tx, userId, 'Setting', after.id, dto(before), this.pickChanged(dto(after), data));
      return dto(after);
    });
  }

  private toData(input: SettingInput) {
    const data: Partial<Pick<Setting, SettingField>> = {};
    if (input.interestRate !== undefined) data.interestRate = input.interestRate === null ? null : rate(input.interestRate);
    if (input.retensiAsCost !== undefined) data.retensiAsCost = input.retensiAsCost;
    if (input.realisasiWarnPct !== undefined) data.realisasiWarnPct = input.realisasiWarnPct === null ? null : rate(input.realisasiWarnPct);
    if (input.realisasiOverPct !== undefined) data.realisasiOverPct = input.realisasiOverPct === null ? null : rate(input.realisasiOverPct);
    for (const k of ['rekeningBank', 'rekeningNo', 'rekeningNama'] as const) {
      if (input[k] !== undefined) data[k] = input[k] || null;
    }
    return data;
  }

  private pickChanged(after: ReturnType<typeof dto>, data: object) {
    const out: Record<string, string | boolean | null> = {};
    for (const k of Object.keys(data)) out[k] = (after as unknown as Record<string, string | boolean | null>)[k];
    return out;
  }
}
