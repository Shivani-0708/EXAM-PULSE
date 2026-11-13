// Exam Lifecycle Routes: Warm-up, Start, Paper delivery, Attempt resume
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { cacheService } from '../services/cache';
import { redisService } from '../redis';
import { config } from '../config';
import { TokenPayload } from '../types';

export async function examRoutes(fastify: FastifyInstance) {
  // Pre-exam warm-up endpoint
  fastify.post('/api/exam/:id/warm', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const examId = parseInt(req.params.id, 10);
    try {
      const result = await cacheService.warmExamCache(examId);
      return reply.send({ success: true, examId, ...result });
    } catch (err: any) {
      return reply.status(500).send({ error: 'WARMUP_FAILED', message: err.message });
    }
  });

  // Paper delivery (cached in Redis and in-memory; zero Postgres hits)
  fastify.get('/api/exam/:id/paper', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const examId = parseInt(req.params.id, 10);
    try {
      const paper = await cacheService.getExamPaper(examId);
      // Remove correct answers from candidate payload
      const sanitizedQuestions = paper.questions.map((q) => ({
        id: q.id,
        examId: q.examId,
        questionNumber: q.questionNumber,
        questionType: q.questionType,
        prompt: q.prompt,
        options: q.options,
        points: q.points,
      }));

      return reply.send({
        meta: paper.meta,
        questions: sanitizedQuestions,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: 'PAPER_FETCH_FAILED', message: err.message });
    }
  });

  // Start exam attempt (Rate-limited, deterministic shuffle, atomic Lua start)
  fastify.post('/api/exam/:id/start', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = (req as any).user as TokenPayload;
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    const examId = parseInt(req.params.id, 10);
    const serverNow = await redisService.getServerTimeMs();

    // 1. Rate Limiting via custom Token-Bucket Lua script
    const rateLimitKey = `start:${examId}`;
    const rl = await redisService.rateLimit(
      rateLimitKey,
      config.startRateLimitBurst,
      config.startRateLimitRefillPerSec,
      1,
      serverNow
    );

    if (!rl.allowed) {
      const retrySec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      reply.header('Retry-After', retrySec);
      return reply.status(429).send({
        error: 'RATE_LIMITED',
        message: 'High burst traffic. Please retry with exponential backoff.',
        retryAfterMs: rl.retryAfterMs,
      });
    }

    // 2. Fetch paper meta & question IDs (cached)
    const paper = await cacheService.getExamPaper(examId);
    const questionIds = paper.questions.map((q) => q.id);

    // 3. Compute deterministic per-candidate question shuffle
    const questionOrder = cacheService.getDeterministicQuestionOrder(examId, user.candidateId, questionIds);

    // 4. Atomic start attempt via Redis Lua
    const hardEndMs = paper.meta.endAt ? new Date(paper.meta.endAt).getTime() : 0;
    const attempt = await redisService.examStart(
      examId,
      user.candidateId,
      JSON.stringify(questionOrder),
      paper.meta.durationMinutes,
      hardEndMs
    );

    return reply.send({
      isNew: attempt.isNew,
      examId,
      candidateId: user.candidateId,
      startedAt: attempt.startedAt,
      deadline: attempt.deadline,
      questionOrder: attempt.questionOrder,
      status: attempt.status,
      serverNow,
    });
  });

  // Resume attempt (Browser crash recovery)
  fastify.get('/api/exam/:id/attempt', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = (req as any).user as TokenPayload;
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    const examId = parseInt(req.params.id, 10);
    const attemptKey = `attempt:${examId}:${user.candidateId}`;
    const answersKey = `answers:${examId}:${user.candidateId}`;

    const [attemptData, rawAnswers, serverNow] = await Promise.all([
      redisService.master.hgetall(attemptKey),
      redisService.master.hgetall(answersKey),
      redisService.getServerTimeMs(),
    ]);

    if (!attemptData || !attemptData.startedAt) {
      return reply.status(404).send({ error: 'NO_ATTEMPT_FOUND', message: 'Exam has not been started yet' });
    }

    // Parse existing answers
    const answers: Record<string, any> = {};
    for (const [qid, val] of Object.entries(rawAnswers || {})) {
      try {
        answers[qid] = JSON.parse(val);
      } catch {
        answers[qid] = { answer: val, version: 1 };
      }
    }

    return reply.send({
      examId,
      candidateId: user.candidateId,
      startedAt: parseInt(attemptData.startedAt, 10),
      deadline: parseInt(attemptData.deadline, 10),
      questionOrder: JSON.parse(attemptData.questionOrder || '[]'),
      status: attemptData.status,
      answers,
      serverNow,
    });
  });
}
