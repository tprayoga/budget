import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hostname } from 'node:os';
import { Public } from './auth/decorators';
import { PrismaService } from './prisma/prisma.service';
import { getRedis } from './redis/redis';

/**
 * Health check untuk Docker healthcheck, deploy.sh dan uptime monitor eksternal.
 * 200 bila database (dan Redis, bila dikonfigurasi) merespons; 503 bila tidak.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    const checks: Record<string, 'ok' | 'error' | 'disabled'> = { db: 'ok', redis: 'disabled' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      checks.db = 'error';
    }
    const r = getRedis();
    if (r) {
      try {
        checks.redis = (await r.ping()) === 'PONG' ? 'ok' : 'error';
      } catch {
        checks.redis = 'error';
      }
    }
    const ok = checks.db === 'ok' && checks.redis !== 'error';
    const body = {
      ok,
      version: process.env.APP_VERSION ?? 'dev',
      checks,
      ...(process.env.EXPOSE_INSTANCE === 'true' ? { instance: hostname() } : {}),
    };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }
}
