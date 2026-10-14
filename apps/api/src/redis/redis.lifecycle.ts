import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { closeRedis } from './redis';

/** Tutup koneksi Redis saat aplikasi berhenti (SIGTERM dari Docker). */
@Injectable()
export class RedisLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await closeRedis();
  }
}
