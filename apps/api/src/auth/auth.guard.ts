import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Role } from '@indotek/shared';
import { ACCESS_COOKIE } from './cookies';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC, ROLES_KEY } from './decorators';
import type { AuthUser, JwtPayload } from './auth.types';

/**
 * Guard global: verifikasi JWT access token dari cookie httpOnly, blokir user yang wajib ganti password,
 * lalu cek @Roles. Token di header Authorization tidak diterima.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token: string | undefined = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('Silakan login');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Sesi berakhir, silakan login ulang');
    }
    const user: AuthUser = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      mustChangePassword: !!payload.mcp,
    };
    req.user = user;

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException({ message: 'Anda wajib mengganti password terlebih dahulu', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('Role Anda tidak berwenang untuk aksi ini');
    }
    return true;
  }
}
