import {
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { apiKeyCreateSchema } from '@indotek/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody } from '../common/zod';

export const WEBHOOK_SCOPE = 'expenses:webhook';
export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');

export interface ApiKeyContext {
  id: string;
  name: string;
}

/**
 * Guard webhook: header `X-API-Key`, dicocokkan dengan hash di DB (scope expenses:webhook), plus rate limit
 * sederhana per key (60 request/menit, memori proses).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { apiKey?: ApiKeyContext }>();
    const raw = req.headers['x-api-key'];
    if (typeof raw !== 'string' || raw.length < 20) throw new UnauthorizedException('API key wajib (header X-API-Key)');
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
    if (!key || key.revokedAt || !key.scopes.includes(WEBHOOK_SCOPE)) throw new UnauthorizedException('API key tidak valid');
    const now = Date.now();
    const recent = (this.hits.get(key.id) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= Number(process.env.WEBHOOK_RATE_LIMIT ?? 60)) {
      throw new HttpException({ message: 'Terlalu banyak request webhook', code: 'RATE_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key.id, recent);
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    req.apiKey = { id: key.id, name: key.name };
    return true;
  }
}

/** Kelola API key (ADMIN). Key mentah hanya ditampilkan sekali saat dibuat. */
@ApiTags('api-keys')
@ApiCookieAuth()
@Controller('api-keys')
@Roles('ADMIN')
export class ApiKeysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const rows = await this.prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { name: true } } } });
    return rows.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      createdBy: k.createdBy.name,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    }));
  }

  @Post()
  @ApiZodBody(apiKeyCreateSchema)
  async create(@CurrentUser() user: AuthUser, @ZBody(apiKeyCreateSchema) body: z.infer<typeof apiKeyCreateSchema>) {
    const prefix = randomBytes(4).toString('hex');
    const key = `ibk_${prefix}_${randomBytes(24).toString('base64url')}`;
    const k = await this.prisma.apiKey.create({
      data: { name: body.name, prefix, keyHash: hashKey(key), scopes: [WEBHOOK_SCOPE], createdById: user.id },
    });
    await this.audit.diff(this.prisma, user.id, 'ApiKey', k.id, null, { name: k.name, prefix, scopes: WEBHOOK_SCOPE });
    return { id: k.id, name: k.name, prefix, key };
  }

  @Delete(':id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const k = await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.diff(this.prisma, user.id, 'ApiKey', id, { revokedAt: null }, { revokedAt: k.revokedAt });
    return { ok: true };
  }
}
