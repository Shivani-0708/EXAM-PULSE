// Behavioural Events and Telemetry Ingestion
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisService } from '../redis';
import { dbService } from '../db';
import { TokenPayload } from '../types';

interface TelemetryEvent {
  type: string; // 'TAB_HIDDEN', 'TAB_VISIBLE', 'FOCUS_LOST', 'FOCUS_GAINED'
  examId: number;
  timestamp: number;
  payload?: any;
}

export async function eventsRoutes(fastify: FastifyInstance) {
  // Candidate heartbeat endpoint
  fastify.post('/api/heartbeat', async (req: FastifyRequest<{ Body: { examId: number; tabSwitchesDelta?: number } }>, reply: FastifyReply) => {
    const user = (req as any).user as TokenPayload;
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    const { examId, tabSwitchesDelta = 0 } = req.body || {};
    const serverNow = await redisService.getServerTimeMs();

    const status = await redisService.heartbeat(examId, user.candidateId, tabSwitchesDelta, serverNow);

    return reply.send({
      acknowledged: true,
      serverNow,
      state: status.state,
    });
  });

  // Batched client behaviour telemetry
  fastify.post('/api/events', async (req: FastifyRequest<{ Body: { events: TelemetryEvent[] } }>, reply: FastifyReply) => {
    const user = (req as any).user as TokenPayload;
    const { events = [] } = req.body || {};

    if (events.length === 0) {
      return reply.send({ received: 0 });
    }

    // Process tab switches
    let tabSwitchCount = 0;
    for (const ev of events) {
      if (ev.type === 'TAB_HIDDEN' || ev.type === 'FOCUS_LOST') {
        tabSwitchCount++;
      }
    }

    const examId = events[0].examId || 1;
    if (tabSwitchCount > 0 && user) {
      const serverNow = await redisService.getServerTimeMs();
      await redisService.heartbeat(examId, user.candidateId, tabSwitchCount, serverNow);
    }

    // Persist events asynchronously to Postgres
    if (user) {
      for (const ev of events) {
        dbService.pool
          .query('INSERT INTO events (candidate_id, exam_id, event_type, payload) VALUES ($1, $2, $3, $4)', [
            user.candidateId,
            ev.examId || 1,
            ev.type,
            JSON.stringify(ev.payload || {}),
          ])
          .catch((err) => console.error('[Event insert error]', err));
      }
    }

    return reply.send({ received: events.length });
  });
}
