import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { parseRedisConnection } from './redis-connection';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis(parseRedisConnection(this.config.getOrThrow<string>('redis.url')));
  }

  async onApplicationShutdown() {
    await this.client.quit();
  }
}
