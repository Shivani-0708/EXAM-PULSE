// Health & Readiness Checks
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisService } from '../redis';
import { dbService } from '../db';
import { config } from '../config';

export async function healthRoutes(fastify: FastifyInstance) {
  // Liveness check (process alive)
  fastify.get('/healthz', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'healthy',
      instanceId: config.instanceId,
      timestamp: Date.now(),
    });
  });

  // Readiness check (checks Redis and PostgreSQL connectivity)
  fastify.get('/readyz', async (_req: FastifyRequest, reply: FastifyReply) => {
    let redisOk = false;
    let dbOk = false;

    try {
      const ping = await redisService.master.ping();
      redisOk = ping === 'PONG';
    } catch {
      redisOk = false;
    }

    try {
      const res = await dbService.pool.query('SELECT 1');
      dbOk = res.rowCount === 1;
    } catch {
      dbOk = false;
    }

    const ready = redisOk && dbOk;
    const statusCode = ready ? 200 : 503;

    return reply.status(statusCode).send({
      status: ready ? 'ready' : 'not_ready',
      instanceId: config.instanceId,
      services: {
        redis: redisOk ? 'up' : 'down',
        database: dbOk ? 'up' : 'down',
      },
      durabilityMode: config.durabilityMode,
      timestamp: Date.now(),
    });
  });
}
