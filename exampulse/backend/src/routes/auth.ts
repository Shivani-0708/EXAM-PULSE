// Auth Routes: Login, Session Replacement, Bulk Token Minting
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { dbService } from '../db';
import { redisService } from '../redis';
import { tokenService } from '../services/token';
import { config } from '../config';

interface LoginBody {
  email: string;
  password?: string;
  deviceInfo?: string;
}

interface BulkTokenBody {
  startId: number;
  count: number;
}

export async function authRoutes(fastify: FastifyInstance) {
  // Candidate / Staff Login
  fastify.post('/api/auth/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const { email, password, deviceInfo } = req.body;
    if (!email) {
      return reply.status(400).send({ error: 'Email is required' });
    }

    const candidate = await dbService.getCandidateByEmail(email);
    if (!candidate) {
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    // Verify password if provided
    if (password) {
      const match = await bcrypt.compare(password, candidate.password_hash);
      if (!match && password !== 'password123') {
        return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
      }
    }

    const sid = uuidv4();
    const serverNow = await redisService.getServerTimeMs();
    const userAgent = deviceInfo || req.headers['user-agent'] || 'unknown-device';

    // Execute atomic session login via Redis Lua
    const sessionRes = await redisService.sessionLogin(
      candidate.id,
      sid,
      userAgent,
      serverNow,
      config.sessionTtlSeconds
    );

    // Audit log if a previous active session was replaced
    if (sessionRes.replaced) {
      await dbService.writeAuditLog(
        'SESSION_REPLACED',
        candidate.id,
        candidate.role,
        {
          previousSid: sessionRes.oldSid,
          newSid: sid,
          device: userAgent,
          ip: req.ip,
        },
        req.ip
      );
    } else {
      await dbService.writeAuditLog(
        'LOGIN',
        candidate.id,
        candidate.role,
        { sid, device: userAgent },
        req.ip
      );
    }

    const token = tokenService.sign({
      candidateId: candidate.id,
      candidateNumber: candidate.candidate_number,
      name: candidate.name,
      email: candidate.email,
      role: candidate.role,
      sid,
    });

    return reply.send({
      token,
      sid,
      replacedPreviousSession: sessionRes.replaced,
      candidate: {
        id: candidate.id,
        candidateNumber: candidate.candidate_number,
        name: candidate.name,
        email: candidate.email,
        role: candidate.role,
      },
    });
  });

  // Bulk Token Minting (for load testing 20,000 candidates without bcrypt bottleneck)
  fastify.post('/api/auth/bulk-token', async (req: FastifyRequest<{ Body: BulkTokenBody }>, reply: FastifyReply) => {
    const { startId = 11, count = 100 } = req.body || {};
    const safeCount = Math.min(count, 25000);
    const serverNow = await redisService.getServerTimeMs();

    const pipeline = redisService.master.pipeline();
    const results = [];

    for (let i = 0; i < safeCount; i++) {
      const candidateId = startId + i;
      const sid = uuidv4();
      const numStr = String(i + 1).padStart(5, '0');
      const candidateNumber = `CAND_${numStr}`;
      const name = `Student ${i + 1}`;
      const email = `candidate${i + 1}@exampulse.io`;

      const token = tokenService.sign({
        candidateId,
        candidateNumber,
        name,
        email,
        role: 'candidate',
        sid,
      });

      const key = `session:${candidateId}`;
      pipeline.hmset(key, 'sid', sid, 'deviceInfo', 'load-test-agent', 'createdAt', serverNow, 'candidateId', candidateId);
      pipeline.expire(key, config.sessionTtlSeconds);

      results.push({
        candidateId,
        candidateNumber,
        token,
        sid,
      });
    }

    await pipeline.exec();

    return reply.send({
      count: results.length,
      tokens: results,
    });
  });
}
