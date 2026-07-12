export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
}

// REDIS_URL carries the db index as its path segment (e.g. redis://localhost:6379/1),
// the same convention DATABASE_URL/MEILI_INDEX_NAME use via a _test-only marker.
// Every Redis connection (cache/rate-limit client, BullMQ) MUST be built through this
// helper so dev (db 0) and test (db 1+) never share keyspace or steal each other's
// BullMQ jobs — see docs/estado-tecnico.md "Colisión Redis dev/test".
export function parseRedisConnection(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  const db = url.pathname && url.pathname !== '/' ? parseInt(url.pathname.slice(1), 10) : 0;
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db,
  };
}
