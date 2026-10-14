import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limiter';

/**
 * Rate limit login per kombinasi IP + email (default 5 percobaan / 60 detik).
 * Redis bila REDIS_URL diisi (berlaku untuk semua replika API), selain itu in-memory.
 */
@Injectable()
export class LoginRateLimiter {
  readonly limit = Number(process.env.LOGIN_RATE_LIMIT ?? 5);
  readonly windowMs = Number(process.env.LOGIN_RATE_WINDOW_MS ?? 60_000);
  private readonly rl = new RateLimiter('rl:login', this.limit, this.windowMs);

  private key(ip: string, email: string) {
    return `${ip}|${email.trim().toLowerCase()}`;
  }

  /** Catat satu percobaan; lempar 429 bila melebihi batas. */
  async hit(ip: string, email: string, now = Date.now()) {
    const r = await this.rl.hit(this.key(ip, email), now);
    if (!r.allowed) {
      throw new HttpException(
        { message: `Terlalu banyak percobaan login. Coba lagi dalam ${r.retryAfter} detik.`, code: 'RATE_LIMIT', retryAfter: r.retryAfter, store: r.store },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Login berhasil → hapus hitungan untuk kombinasi tersebut. */
  async reset(ip: string, email: string) {
    await this.rl.reset(this.key(ip, email));
  }
}
