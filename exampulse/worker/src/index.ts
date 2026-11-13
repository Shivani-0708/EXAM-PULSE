// Worker Entry Point for ExamPulse
import Redis from 'ioredis';
import { Pool } from 'pg';
import { AnswerPersister } from './persister';
import { SubmissionFinaliser } from './finaliser';
import { AnswerReconciler } from './reconciler';
import { HeartbeatSweeper } from './sweeper';

const workerId = process.env.WORKER_ID || `worker-${process.pid}`;
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const databaseUrl = process.env.DATABASE_URL || 'postgres://exampulse_user:exampulse_password@localhost:5432/exampulse';

async function bootstrap() {
  console.log(`[ExamPulse Worker] Starting ${workerId}...`);

  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    retryStrategy: (times) => Math.min(times * 100, 2000),
  });

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
  });

  const persister = new AnswerPersister(redis, pool, workerId);
  const finaliser = new SubmissionFinaliser(redis, pool, workerId);
  const reconciler = new AnswerReconciler(redis, pool, 30000);
  const sweeper = new HeartbeatSweeper(redis, 5000);

  await persister.init();
  await finaliser.init();

  // Run all background workers concurrently
  persister.start().catch((err) => console.error('[Persister Fatal]', err));
  finaliser.start().catch((err) => console.error('[Finaliser Fatal]', err));
  reconciler.start().catch((err) => console.error('[Reconciler Fatal]', err));
  sweeper.start().catch((err) => console.error('[Sweeper Fatal]', err));

  console.log(`[ExamPulse Worker ${workerId}] All consumers and sweepers active.`);

  const shutdown = async () => {
    console.log(`[ExamPulse Worker ${workerId}] Shutting down...`);
    persister.stop();
    finaliser.stop();
    reconciler.stop();
    sweeper.stop();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('[ExamPulse Worker] Failed to start:', err);
  process.exit(1);
});
