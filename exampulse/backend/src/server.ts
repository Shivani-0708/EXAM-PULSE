// ExamPulse Fastify Application Server
import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config';
import { redisService } from './redis';
import { dbService } from './db';
import { tokenService } from './services/token';
import { recordLatency } from './routes/metrics';
import { authRoutes } from './routes/auth';
import { timeRoutes } from './routes/time';
import { examRoutes } from './routes/exam';
import { answersRoutes } from './routes/answers';
import { submitRoutes } from './routes/submit';
import { leaderboardRoutes } from './routes/leaderboard';
import { dashboardRoutes } from './routes/dashboard';
import { eventsRoutes } from './routes/events';
import { healthRoutes } from './routes/health';
import { metricsRoutes } from './routes/metrics';

export async function buildServer(): Promise<FastifyInstance> {
  const server = fastify({
    logger: false, // Minimized overhead for 20k burst load testing
    trustProxy: true,
  });

  await server.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-ID'],
  });

  await server.register(websocket);

  // Track connected dashboard WebSockets for batched fan-out
  const dashboardSockets = new Set<any>();
  // Track candidate WebSockets for session replacement notifications
  const candidateSockets = new Map<number, Set<any>>();

  // Global request duration & latency tracking hook
  server.addHook('onRequest', async (req) => {
    (req as any).startTime = Date.now();
  });

  server.addHook('onResponse', async (req, reply) => {
    const start = (req as any).startTime;
    if (start) {
      const duration = Date.now() - start;
      recordLatency(duration);
    }
  });

  // Authentication & Single Active Session Verification Hook
  server.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url;
    // Whitelist public endpoints
    if (
      url.startsWith('/healthz') ||
      url.startsWith('/readyz') ||
      url.startsWith('/metrics') ||
      url.startsWith('/api/time') ||
      url.startsWith('/api/auth/login') ||
      url.startsWith('/api/auth/bulk-token') ||
      url.startsWith('/ws')
    ) {
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.substring(7);
    const decoded = tokenService.verify(token);
    if (!decoded) {
      return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Token is invalid or expired' });
    }

    // Single Active Session check: Fast GET against session:{candidateId}
    const currentSid = await redisService.master.hget(`session:${decoded.candidateId}`, 'sid');
    if (!currentSid || currentSid !== decoded.sid) {
      return reply.status(401).send({
        error: 'SESSION_REPLACED',
        message: 'Your session has been replaced by a login on another device or tab.',
      });
    }

    (req as any).user = decoded;
  });

  // Register API route plugins
  await server.register(authRoutes);
  await server.register(timeRoutes);
  await server.register(examRoutes);
  await server.register(answersRoutes);
  await server.register(submitRoutes);
  await server.register(leaderboardRoutes);
  await server.register(dashboardRoutes);
  await server.register(eventsRoutes);
  await server.register(healthRoutes);
  await server.register(metricsRoutes);

  // WebSocket endpoints
  server.get('/ws/dashboard', { websocket: true }, (connection, req) => {
    dashboardSockets.add(connection.socket);
    connection.socket.on('close', () => {
      dashboardSockets.delete(connection.socket);
    });
  });

  server.get('/ws/candidate', { websocket: true }, (connection, req) => {
    let candidateId: number | null = null;
    connection.socket.on('message', async (rawMsg) => {
      try {
        const msg = JSON.parse(rawMsg.toString());
        if (msg.type === 'IDENTIFY' && msg.token) {
          const payload = tokenService.verify(msg.token);
          if (payload) {
            candidateId = payload.candidateId;
            if (!candidateSockets.has(candidateId)) {
              candidateSockets.set(candidateId, new Set());
            }
            candidateSockets.get(candidateId)!.add(connection.socket);
          }
        }
      } catch {}
    });

    connection.socket.on('close', () => {
      if (candidateId && candidateSockets.has(candidateId)) {
        candidateSockets.get(candidateId)!.delete(connection.socket);
      }
    });
  });

  // Redis Pub/Sub subscription for inter-instance fan-out and session invalidation
  await redisService.subscriber.subscribe('channel:session_invalidated', 'channel:dashboard:1');

  redisService.subscriber.on('message', (channel, message) => {
    if (channel === 'channel:session_invalidated') {
      try {
        const data = JSON.parse(message);
        const sockets = candidateSockets.get(data.candidateId);
        if (sockets) {
          const payload = JSON.stringify({
            type: 'SESSION_REPLACED',
            message: 'You have been logged out because another device signed into your account.',
            ...data,
          });
          for (const s of sockets) {
            if (s.readyState === 1) s.send(payload);
          }
        }
      } catch {}
    } else if (channel.startsWith('channel:dashboard')) {
      // Buffer dashboard event for 500ms batched aggregation
      pendingDashboardDeltas.push(JSON.parse(message));
    }
  });

  // Batched dashboard aggregator: flushes every 500ms
  const pendingDashboardDeltas: any[] = [];
  setInterval(async () => {
    if (dashboardSockets.size === 0 || pendingDashboardDeltas.length === 0) return;

    const deltas = [...pendingDashboardDeltas];
    pendingDashboardDeltas.length = 0;

    const batchMsg = JSON.stringify({
      type: 'BATCH_UPDATE',
      deltas,
      timestamp: Date.now(),
    });

    for (const ws of dashboardSockets) {
      if (ws.readyState === 1) {
        ws.send(batchMsg);
      }
    }
  }, 500);

  return server;
}

export async function startServer() {
  await redisService.connect();
  const server = await buildServer();

  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`[ExamPulse] ${config.instanceId} running at http://${config.host}:${config.port}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log(`[ExamPulse] Shutting down ${config.instanceId}...`);
    await server.close();
    await redisService.close();
    await dbService.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  startServer();
}
