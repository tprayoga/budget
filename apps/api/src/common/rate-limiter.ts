import { randomBytes } from 'node:crypto';
import { getRedis } from '../redis/redis';

export interface RateResult {
  allowed: boolean;
  /** Detik sampai boleh mencoba lagi (bila ditolak). */
  retryAfter: number;
  /** 'redis' | 'memory' — implementasi yang dipakai (bukti di uji 2 replika). */
  store: 'redis' | 'memory';
}

// Sliding window atomik di Redis (sorted set per kunci)
const LUA = `
local k = KEYS[1]
local now = tonumber(ARGV[1])
local win = tonumber(ARGV[2])
local lim = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', k, 0, now - win)
local c = redis.call('ZCARD', k)
if c >= lim then
  local o = redis.call('ZRANGE', k, 0, 0, 'WITHSCORES')
  return {0, tonumber(o[2])}
end
redis.call('ZADD', k, now, ARGV[4])
redis.call('PEXPIRE', k, win)
return {1, 0}
`;

/**
 * Rate limiter sliding window. Memakai Redis bila REDIS_URL diisi (berlaku lintas replika API),
 * selain itu in-memory per proses (dev/test, satu instance).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly prefix: string,
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  async hit(key: string, now = Date.now()): Promise<RateResult> {
    const r = getRedis();
    if (r) {
      const [ok, oldest] = (await r.eval(LUA, 1, `${this.prefix}:${key}`, now, this.windowMs, this.limit, `${now}-${randomBytes(4).toString('hex')}`)) as [number, number];
      return { allowed: ok === 1, retryAfter: ok === 1 ? 0 : Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)), store: 'redis' };
    }
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)), store: 'memory' };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return { allowed: true, retryAfter: 0, store: 'memory' };
  }

  async reset(key: string) {
    const r = getRedis();
    if (r) await r.del(`${this.prefix}:${key}`);
    else this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}
