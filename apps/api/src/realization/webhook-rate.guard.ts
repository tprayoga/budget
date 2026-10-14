import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimiter } from '../common/rate-limiter';

/**
 * Rate limit webhook per API key (default 60 request / 60 detik; WEBHOOK_RATE_LIMIT, WEBHOOK_RATE_WINDOW_MS).
 * Dipasang setelah ApiKeyGuard (butuh req.apiKey). Redis bila REDIS_URL diisi.
 */
@Injectable()
export class WebhookRateGuard implements CanActivate {
  private readonly rl = new RateLimiter('rl:webhook', Number(process.env.WEBHOOK_RATE_LIMIT ?? 60), Number(process.env.WEBHOOK_RATE_WINDOW_MS ?? 60_000));

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { apiKey?: { id: string } }>();
    const r = await this.rl.hit(req.apiKey?.id ?? `ip:${req.ip}`);
    if (!r.allowed) {
      throw new HttpException(
        { message: `Batas kiriman webhook terlampaui. Coba lagi dalam ${r.retryAfter} detik.`, code: 'RATE_LIMIT', retryAfter: r.retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
