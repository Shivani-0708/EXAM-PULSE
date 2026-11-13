// Time synchronization route for server-authoritative timer
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisService } from '../redis';

export async function timeRoutes(fastify: FastifyInstance) {
  fastify.get('/api/time', async (_req: FastifyRequest, reply: FastifyReply) => {
    const serverNow = await redisService.getServerTimeMs();
    return reply.send({
      serverNow,
      epoch: serverNow,
      precision: 'ms',
    });
  });
}
