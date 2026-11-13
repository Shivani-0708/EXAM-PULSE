// Environment configuration for ExamPulse backend

export const config = {
  instanceId: process.env.INSTANCE_ID || 'app1',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  
  // Database configuration
  databaseUrl: process.env.DATABASE_URL || 'postgres://exampulse_user:exampulse_password@localhost:5432/exampulse',
  
  // Redis Master & Replica configuration
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  redisReplicaHost: process.env.REDIS_REPLICA_HOST || undefined,
  redisReplicaPort: parseInt(process.env.REDIS_REPLICA_PORT || '6380', 10),
  
  // Durability mode: 'aof_wait' | 'aof_only' | 'fsync_always'
  // - aof_wait: Lua writes to master (AOF everysec) + WAIT 1 <waitTimeoutMs> for replica ack
  // - aof_only: Lua writes to master (AOF everysec), no replica WAIT
  // - fsync_always: Redis configured with appendfsync always (highest durability)
  durabilityMode: (process.env.DURABILITY_MODE || 'aof_wait') as 'aof_wait' | 'aof_only' | 'fsync_always',
  waitTimeoutMs: parseInt(process.env.WAIT_TIMEOUT_MS || '50', 10),
  
  // Auth & Security
  jwtSecret: process.env.JWT_SECRET || 'supersecret_exampulse_jwt_signing_key_2026',
  sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS || '86400', 10),
  
  // Rate Limiting
  startRateLimitBurst: parseInt(process.env.START_RATE_LIMIT_BURST || '2000', 10),
  startRateLimitRefillPerSec: parseInt(process.env.START_RATE_LIMIT_REFILL || '500', 10),
  
  // AI Collusion Service
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  aiTimeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '1000', 10),
  
  // Grace period policy (default 0 ms)
  defaultGraceMs: parseInt(process.env.DEFAULT_GRACE_MS || '0', 10),
};
