import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';

/**
 * Klien Redis bersama (singleton per proses). Aktif hanya bila REDIS_URL diisi (production / stack prod);
 * tanpa REDIS_URL (dev, test) fitur yang memakainya jatuh ke implementasi in-memory.
 */
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  client = url ? new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false }) : null;
  client?.on('error', (e) => console.error(JSON.stringify({ level: 'error', msg: 'redis error', err: e.message })));
  return client;
}

export async function closeRedis() {
  if (client) await client.quit().catch(() => undefined);
  client = undefined;
}

/** Reset singleton (test). */
export function setRedisForTest(r: Redis | null | undefined) {
  client = r;
}

/**
 * Jalankan fn di bawah lock terdistribusi (SET NX PX). Bila lock dipegang replika lain, tunggu sampai bebas
 * (maks waitMs); tanpa Redis fn langsung dijalankan. Lock dilepas hanya oleh pemiliknya (token).
 */
export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>, waitMs = 15_000): Promise<T> {
  const r = getRedis();
  if (!r) return fn();
  const token = randomBytes(12).toString('hex');
  const deadline = Date.now() + waitMs;
  while ((await r.set(key, token, 'PX', ttlMs, 'NX')) !== 'OK') {
    if (Date.now() > deadline) throw new Error(`Lock ${key} tidak didapat dalam ${waitMs} ms`);
    await new Promise((res) => setTimeout(res, 100));
  }
  try {
    return await fn();
  } finally {
    await r.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token).catch(() => undefined);
  }
}
