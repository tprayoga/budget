import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { accessTtlMs, refreshTtlMs } from './cookies';
import type { JwtPayload } from './auth.types';

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Email atau password salah');
    }
    return { tokens: await this.issueTokens(user), user: await this.me(user.id) };
  }

  /** Rotasi refresh token: token lama dicabut, token baru diterbitkan. */
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('Sesi berakhir, silakan login ulang');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.active) {
      throw new UnauthorizedException('Sesi berakhir, silakan login ulang');
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return { tokens: await this.issueTokens(stored.user), user: await this.me(stored.user.id) };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Ganti password: verifikasi password lama, cabut semua sesi lain, terbitkan token baru. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException({ message: 'Password lama salah', errors: [{ path: 'currentPassword', message: 'Password lama salah' }] });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false },
      });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      // nilai password tidak dicatat; hanya fakta perubahan
      await this.audit.log(tx, userId, [{ entity: 'User', entityId: userId, field: 'password', oldValue: '***', newValue: 'diganti' }]);
      return u;
    });
    return { tokens: await this.issueTokens(updated), user: await this.me(userId) };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { select: { projectId: true } } },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      jabatan: user.jabatan,
      mustChangePassword: user.mustChangePassword,
      projectIds: user.memberships.map((m) => m.projectId),
    };
  }

  private async issueTokens(user: { id: string; email: string; name: string; role: Role; mustChangePassword: boolean }): Promise<IssuedTokens> {
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role, mcp: user.mustChangePassword };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: Math.floor(accessTtlMs() / 1000),
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + refreshTtlMs()) },
    });
    return { accessToken, refreshToken, csrfToken: randomBytes(32).toString('base64url') };
  }
}
