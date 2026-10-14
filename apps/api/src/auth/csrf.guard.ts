import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CSRF_COOKIE, CSRF_HEADER, verifyCsrfToken } from './cookies';
import { SKIP_CSRF } from './decorators';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteksi CSRF double-submit bertanda tangan: setiap request yang mengubah data wajib membawa header X-CSRF-Token
 * yang sama dengan cookie csrf_token, dan token harus ditandatangani HMAC dengan COOKIE_SECRET (cookie yang
 * disuntikkan dari subdomain lain tanpa secret ditolak). Situs lain tidak bisa membaca cookie tersebut.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()])) return true;
    const cookie = req.cookies?.[CSRF_COOKIE];
    const header = req.headers[CSRF_HEADER];
    if (typeof cookie !== 'string' || typeof header !== 'string' || !cookie || cookie.length !== header.length) {
      throw new ForbiddenException({ message: 'Token CSRF tidak valid', code: 'CSRF' });
    }
    if (!timingSafeEqual(Buffer.from(cookie), Buffer.from(header)) || !verifyCsrfToken(cookie)) {
      throw new ForbiddenException({ message: 'Token CSRF tidak valid', code: 'CSRF' });
    }
    return true;
  }
}
