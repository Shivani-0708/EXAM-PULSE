// Final Submission Route: Strict Idempotency and Deadline Validation
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { redisService } from '../redis';
import { TokenPayload } from '../types';
import { config } from '../config';

export async function submitRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/api/exam/:id/submit',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body?: { idempotencyKey?: string };
      }>,
      reply: FastifyReply
    ) => {
      const user = (req as any).user as TokenPayload;
      if (!user) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' });
      }

      const examId = parseInt(req.params.id, 10);
      const idempotencyKey =
        (req.headers['idempotency-key'] as string) ||
        req.body?.idempotencyKey ||
        `idem-${user.candidateId}-${examId}`;

      const clientTs = Date.now();

      // 1. Execute atomic final submission Lua script
      const submitRes = await redisService.finalSubmit(
        examId,
        user.candidateId,
        idempotencyKey,
        config.defaultGraceMs,
        clientTs
      );

      if (submitRes.status === 'ERROR_NO_ATTEMPT') {
        return reply.status(404).send({
          error: 'NO_ATTEMPT',
          message: 'Cannot submit: No active exam attempt found.',
        });
      }

      // 2. Guarantee durability via Redis WAIT
      await redisService.executeWait();

      return reply.send({
        success: true,
        outcome: submitRes.status,
        submission: submitRes.result,
      });
    }
  );
}
