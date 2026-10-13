import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './auth.types';

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Email atau password salah');
    }
    return this.issueTokens(user);
  }

  /** Rotasi refresh token: token lama dicabut, token baru diterbitkan. */
  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.active) {
      throw new UnauthorizedException('Refresh token tidak valid');
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(stored.user);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
      projectIds: user.memberships.map((m) => m.projectId),
    };
  }

  private async issueTokens(user: { id: string; email: string; name: string; role: Role }) {
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
    });
    const refreshToken = randomBytes(48).toString('base64url');
    const days = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    return { accessToken, refreshToken, user: await this.me(user.id) };
  }
}
