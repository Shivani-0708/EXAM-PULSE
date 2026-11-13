// Autosave Routes: Version-gated answer write with replica acknowledgement
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisService } from '../redis';
import { TokenPayload, AutosaveRequest } from '../types';
import { config } from '../config';

export async function answersRoutes(fastify: FastifyInstance) {
  fastify.put(
    '/api/exam/:id/answers/:qid',
    async (
      req: FastifyRequest<{
        Params: { id: string; qid: string };
        Body: AutosaveRequest;
      }>,
      reply: FastifyReply
    ) => {
      const user = (req as any).user as TokenPayload;
      if (!user) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' });
      }

      const examId = parseInt(req.params.id, 10);
      const questionId = parseInt(req.params.qid, 10);
      const { answer, version, clientTs = Date.now() } = req.body || {};

      if (version === undefined || version === null) {
        return reply.status(400).send({ error: 'MISSING_VERSION', message: 'Client version counter is required' });
      }

      // 1. Run atomic Lua script on Redis master
      const saveRes = await redisService.autosave(
        examId,
        user.candidateId,
        questionId,
        answer !== undefined ? String(answer) : '',
        version,
        clientTs,
        config.defaultGraceMs
      );

      // Handle deadline expiration
      if (saveRes.status === 'ERROR_EXPIRED') {
        return reply.status(403).send({
          saved: false,
          error: 'DEADLINE_EXPIRED',
          message: 'The examination deadline has passed. Answers can no longer be accepted.',
        });
      }

      // Handle already submitted attempt
      if (saveRes.status === 'ERROR_ALREADY_SUBMITTED') {
        return reply.status(400).send({
          saved: false,
          error: 'ALREADY_SUBMITTED',
          message: 'This exam attempt has already been finalized and submitted.',
        });
      }

      // Handle no attempt found
      if (saveRes.status === 'ERROR_NO_ATTEMPT') {
        return reply.status(404).send({
          saved: false,
          error: 'NO_ATTEMPT',
          message: 'No active exam attempt found. Please start the exam first.',
        });
      }

      // Stale version (higher version already accepted previously)
      if (saveRes.status === 'STALE_VERSION') {
        return reply.send({
          saved: true,
          version: saveRes.version,
          serverTs: saveRes.serverTs,
          answeredCount: saveRes.answeredCount,
          note: 'STALE_IGNORED',
        });
      }

      // 2. Durability enforcement: WAIT command for replica acknowledgment
      const replicaAck = await redisService.executeWait();
      if (!replicaAck) {
        // Master accepted, but replica acknowledgment failed within waitTimeoutMs
        return reply.status(503).send({
          saved: false,
          error: 'REPLICA_ACK_FAILED',
          message: 'Answer buffered on master but replica acknowledgment timed out. Retrying.',
        });
      }

      // Fully acknowledged & durable
      return reply.send({
        saved: true,
        version: saveRes.version,
        serverTs: saveRes.serverTs,
        answeredCount: saveRes.answeredCount,
      });
    }
  );
}
