// Invigilator Dashboard Routes: Aggregated counters, candidate virtualized list, flag reviews
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisService } from '../redis';
import { dbService } from '../db';
import { TokenPayload } from '../types';

export async function dashboardRoutes(fastify: FastifyInstance) {
  // Summary counters for invigilator header
  fastify.get('/api/dashboard/summary', async (req: FastifyRequest<{ Querystring: { examId?: string } }>, reply: FastifyReply) => {
    const examId = parseInt(req.query.examId || '1', 10);
    const serverNow = await redisService.getServerTimeMs();

    // Query status counts from Redis or DB
    const [activeCount, disconnectedCount, submittedCount, flaggedCount] = await Promise.all([
      redisService.master.zcount(`heartbeats:${examId}`, serverNow - 15000, '+inf'),
      redisService.master.zcount(`heartbeats:${examId}`, '-inf', serverNow - 15000),
      dbService.pool.query('SELECT COUNT(*) FROM submissions WHERE status = $1', ['SUBMITTED']),
      dbService.pool.query('SELECT COUNT(*) FROM flags WHERE status = $1', ['PENDING']),
    ]);

    return reply.send({
      examId,
      serverNow,
      counts: {
        active: activeCount || 0,
        disconnected: disconnectedCount || 0,
        submitted: parseInt(submittedCount.rows[0]?.count || '0', 10),
        flagged: parseInt(flaggedCount.rows[0]?.count || '0', 10),
        totalCandidates: 20000,
      },
    });
  });

  // Candidate list with pagination, filtering by state, search by ID
  fastify.get(
    '/api/dashboard/candidates',
    async (
      req: FastifyRequest<{
        Querystring: {
          examId?: string;
          status?: string;
          search?: string;
          page?: string;
          limit?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const examId = parseInt(req.query.examId || '1', 10);
      const filterStatus = req.query.status || 'ALL';
      const search = req.query.search?.trim().toUpperCase() || '';
      const page = Math.max(1, parseInt(req.query.page || '1', 10));
      const limit = Math.min(100, Math.max(10, parseInt(req.query.limit || '50', 10)));
      const offset = (page - 1) * limit;

      const serverNow = await redisService.getServerTimeMs();

      // Fetch sample batch of candidates from database
      let query = `
        SELECT c.id, c.candidate_number, c.name, c.email,
               COALESCE(a.status, 'NOT_STARTED') AS attempt_status,
               COALESCE(s.status, '') AS submission_status
        FROM candidates c
        LEFT JOIN attempts a ON a.candidate_id = c.id AND a.exam_id = $1
        LEFT JOIN submissions s ON s.attempt_id = a.id
        WHERE c.role = 'candidate'
      `;
      const params: any[] = [examId];

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (c.candidate_number ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
      }

      query += ` ORDER BY c.id ASC LIMIT ${limit} OFFSET ${offset}`;

      const res = await dbService.pool.query(query, params);

      // Pipelined lookup from Redis status hash
      const pipeline = redisService.master.pipeline();
      for (const row of res.rows) {
        pipeline.hgetall(`status:${examId}:${row.id}`);
      }
      const redisStatuses = await pipeline.exec();

      const candidates = res.rows.map((row, idx) => {
        const rStatus = (redisStatuses?.[idx]?.[1] as Record<string, string>) || {};
        let state = rStatus.state || row.attempt_status || 'NOT_STARTED';
        const lastSeen = parseInt(rStatus.lastSeen || '0', 10);

        // Sweeper logic check
        if (state === 'ACTIVE' && lastSeen > 0 && serverNow - lastSeen > 15000) {
          state = 'DISCONNECTED';
        }

        return {
          candidateId: row.id,
          candidateNumber: row.candidate_number,
          name: row.name,
          state,
          lastSeen,
          tabSwitches: parseInt(rStatus.tabSwitches || '0', 10),
          answeredCount: parseInt(rStatus.answeredCount || '0', 10),
        };
      });

      return reply.send({
        examId,
        page,
        limit,
        candidates: filterStatus === 'ALL' ? candidates : candidates.filter((c) => c.state === filterStatus),
      });
    }
  );

  // Collusion flags list
  fastify.get('/api/dashboard/flags', async (req: FastifyRequest<{ Querystring: { examId?: string } }>, reply: FastifyReply) => {
    const examId = parseInt(req.query.examId || '1', 10);
    const res = await dbService.pool.query(
      `SELECT f.*, c.name, c.candidate_number 
       FROM flags f
       JOIN candidates c ON c.id = f.candidate_id
       WHERE f.exam_id = $1 
       ORDER BY f.risk_score DESC, f.created_at DESC`,
      [examId]
    );

    return reply.send({
      examId,
      flags: res.rows,
    });
  });

  // Invigilator Review Action on Flag (Reviewed / Dismissed / Escalated)
  fastify.post(
    '/api/dashboard/flags/:id/review',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { action: 'REVIEWED' | 'DISMISSED' | 'ESCALATED'; notes?: string };
      }>,
      reply: FastifyReply
    ) => {
      const user = (req as any).user as TokenPayload;
      const flagId = parseInt(req.params.id, 10);
      const { action, notes } = req.body;

      if (!['REVIEWED', 'DISMISSED', 'ESCALATED'].includes(action)) {
        return reply.status(400).send({ error: 'INVALID_ACTION', message: 'Action must be REVIEWED, DISMISSED, or ESCALATED' });
      }

      await dbService.pool.query(
        'UPDATE flags SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3',
        [action, user?.candidateId || 1, flagId]
      );

      await dbService.writeAuditLog(
        'FLAG_REVIEW',
        user?.candidateId || 1,
        user?.role || 'invigilator',
        { flagId, action, notes },
        req.ip
      );

      return reply.send({ success: true, flagId, status: action });
    }
  );
}
