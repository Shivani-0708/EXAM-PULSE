// Real-Time Leaderboard Routes: High performance sorted set queries under 50ms
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisService } from '../redis';
import { TokenPayload, LeaderboardEntry } from '../types';

export async function leaderboardRoutes(fastify: FastifyInstance) {
  // Top N leaderboard entries
  fastify.get(
    '/api/leaderboard',
    async (
      req: FastifyRequest<{
        Querystring: { examId?: string; top?: string };
      }>,
      reply: FastifyReply
    ) => {
      const examId = parseInt(req.query.examId || '1', 10);
      const top = Math.min(parseInt(req.query.top || '50', 10), 500);

      const zsetKey = `leaderboard:${examId}`;

      // ZREVRANGE with scores: 0 to top - 1
      const rawEntries = await redisService.master.zrevrange(zsetKey, 0, top - 1, 'WITHSCORES');
      if (!rawEntries || rawEntries.length === 0) {
        return reply.send({ examId, total: 0, entries: [] });
      }

      // Parse candidate IDs and composite scores
      const candidateIds: string[] = [];
      const parsedScores: Array<{ candidateId: number; rawScore: number }> = [];

      for (let i = 0; i < rawEntries.length; i += 2) {
        const cid = rawEntries[i];
        const compositeScore = parseFloat(rawEntries[i + 1]);
        candidateIds.push(cid);
        parsedScores.push({ candidateId: parseInt(cid, 10), rawScore: compositeScore });
      }

      // Pipelined name lookup from Redis hash to avoid N+1 queries
      const pipeline = redisService.master.pipeline();
      for (const cid of candidateIds) {
        pipeline.hgetall(`candidate_info:${cid}`);
      }
      const candidateInfoResults = await pipeline.exec();

      const entries: LeaderboardEntry[] = parsedScores.map((item, idx) => {
        // Decode composite score: score * 1e9 + (1e9 - secondsTaken)
        const score = Math.floor(item.rawScore / 1e9);
        const secondsTaken = Math.max(0, Math.floor(1e9 - (item.rawScore % 1e9)));

        const info = (candidateInfoResults?.[idx]?.[1] as Record<string, string>) || {};
        return {
          rank: idx + 1,
          candidateId: item.candidateId,
          candidateNumber: info.candidateNumber || `CAND_${String(item.candidateId).padStart(5, '0')}`,
          name: info.name || `Student ${item.candidateId}`,
          score,
          secondsTaken,
        };
      });

      return reply.send({
        examId,
        total: entries.length,
        entries,
      });
    }
  );

  // Candidate's own rank and score
  fastify.get('/api/leaderboard/me', async (req: FastifyRequest<{ Querystring: { examId?: string } }>, reply: FastifyReply) => {
    const user = (req as any).user as TokenPayload;
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    const examId = parseInt(req.query.examId || '1', 10);
    const zsetKey = `leaderboard:${examId}`;

    const [rankIndex, rawScore] = await Promise.all([
      redisService.master.zrevrank(zsetKey, String(user.candidateId)),
      redisService.master.zscore(zsetKey, String(user.candidateId)),
    ]);

    if (rankIndex === null || rawScore === null) {
      return reply.send({
        ranked: false,
        message: 'No score recorded yet for this exam',
      });
    }

    const numericScore = parseFloat(rawScore);
    const score = Math.floor(numericScore / 1e9);
    const secondsTaken = Math.max(0, Math.floor(1e9 - (numericScore % 1e9)));

    return reply.send({
      ranked: true,
      rank: rankIndex + 1,
      candidateId: user.candidateId,
      candidateNumber: user.candidateNumber,
      name: user.name,
      score,
      secondsTaken,
    });
  });
}
