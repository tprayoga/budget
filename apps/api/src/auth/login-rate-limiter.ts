import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Rate limit login per kombinasi IP + email (default 5 percobaan / 60 detik).
 * Disimpan di memori proses — cukup untuk satu instance API; pakai Redis bila API di-scale horizontal.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly hits = new Map<string, number[]>();
  readonly limit = Number(process.env.LOGIN_RATE_LIMIT ?? 5);
  readonly windowMs = Number(process.env.LOGIN_RATE_WINDOW_MS ?? 60_000);

  private key(ip: string, email: string) {
    return `${ip}|${email.trim().toLowerCase()}`;
  }

  /** Catat satu percobaan; lempar 429 bila melebihi batas. */
  hit(ip: string, email: string, now = Date.now()) {
    const k = this.key(ip, email);
    const recent = (this.hits.get(k) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      const retry = Math.ceil((recent[0] + this.windowMs - now) / 1000);
      this.hits.set(k, recent);
      throw new HttpException(
        { message: `Terlalu banyak percobaan login. Coba lagi dalam ${retry} detik.`, code: 'RATE_LIMIT', retryAfter: retry },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(k, recent);
    if (this.hits.size > 10_000) this.prune(now);
  }

  /** Login berhasil → hapus hitungan untuk kombinasi tersebut. */
  reset(ip: string, email: string) {
    this.hits.delete(this.key(ip, email));
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}
