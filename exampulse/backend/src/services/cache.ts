// Cache Service: Redis warm-up, In-Memory caching with jitter, and Single-Flight Locking
import crypto from 'crypto';
import { redisService } from '../redis';
import { dbService } from '../db';
import { ExamMeta, Question } from '../types';

interface InMemoryPaper {
  meta: ExamMeta;
  questions: Question[];
  expiresAt: number;
}

export class CacheService {
  private inMemoryCache: Map<number, InMemoryPaper> = new Map();

  /**
   * Deterministic Linear Congruential Generator (LCG) seeded shuffle.
   * Ensures identical question ordering for candidateId across all instances without DB queries.
   */
  public getDeterministicQuestionOrder(examId: number, candidateId: number, questionIds: number[]): number[] {
    const seedStr = `${examId}:${candidateId}`;
    let seed = crypto.createHash('md5').update(seedStr).digest().readUInt32BE(0);

    const shuffled = [...questionIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      // LCG step
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const j = Math.floor((seed / 4294967296) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Admin/Warmup script: Preloads question bank & meta from PostgreSQL into Redis
   */
  public async warmExamCache(examId: number): Promise<{ success: boolean; questionCount: number }> {
    const examRow = await dbService.getExamById(examId);
    if (!examRow) {
      throw new Error(`Exam ${examId} not found in PostgreSQL`);
    }

    const questions = await dbService.getQuestionsByExamId(examId);

    const meta: ExamMeta = {
      id: examRow.id,
      title: examRow.title,
      description: examRow.description,
      durationMinutes: examRow.duration_minutes,
      startAt: examRow.start_at,
      endAt: examRow.end_at,
      graceMs: examRow.grace_ms,
      isActive: examRow.is_active,
    };

    // Store in Redis with 24h + jitter TTL
    const jitterSec = Math.floor(Math.random() * 3600);
    const ttl = 86400 + jitterSec;

    await redisService.master.set(`exam:${examId}:meta`, JSON.stringify(meta), 'EX', ttl);
    await redisService.master.set(`exam:${examId}:questions`, JSON.stringify(questions), 'EX', ttl);

    // Warm local memory cache as well
    this.updateInMemoryCache(examId, meta, questions);

    return { success: true, questionCount: questions.length };
  }

  private updateInMemoryCache(examId: number, meta: ExamMeta, questions: Question[]) {
    // 30 seconds TTL + 0-10s random jitter
    const ttlMs = 30000 + Math.floor(Math.random() * 10000);
    this.inMemoryCache.set(examId, {
      meta,
      questions,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Fetches exam paper using:
   * 1. Per-instance in-memory cache
   * 2. Redis warm cache
   * 3. Single-flight Redis lock (SET NX PX) for database fill to prevent cache stampede
   */
  public async getExamPaper(examId: number): Promise<{ meta: ExamMeta; questions: Question[] }> {
    // 1. Check in-memory copy
    const inMem = this.inMemoryCache.get(examId);
    if (inMem && Date.now() < inMem.expiresAt) {
      return { meta: inMem.meta, questions: inMem.questions };
    }

    // 2. Check Redis cache
    const [rawMeta, rawQuestions] = await Promise.all([
      redisService.master.get(`exam:${examId}:meta`),
      redisService.master.get(`exam:${examId}:questions`),
    ]);

    if (rawMeta && rawQuestions) {
      const meta = JSON.parse(rawMeta);
      const questions = JSON.parse(rawQuestions);
      this.updateInMemoryCache(examId, meta, questions);
      return { meta, questions };
    }

    // 3. Cache Miss: Single-flight Redis lock to load from Postgres
    const lockKey = `lock:exam:${examId}:fill`;
    const lockVal = `${process.pid}-${Date.now()}`;
    const acquired = await redisService.acquireLock(lockKey, lockVal, 3000);

    if (acquired) {
      try {
        const warmed = await this.warmExamCache(examId);
        const inMemUpdated = this.inMemoryCache.get(examId);
        if (inMemUpdated) {
          return { meta: inMemUpdated.meta, questions: inMemUpdated.questions };
        }
      } finally {
        await redisService.releaseLock(lockKey, lockVal);
      }
    } else {
      // If lock not acquired, wait briefly (50ms) and retry reading from Redis
      await new Promise((r) => setTimeout(r, 50));
      const [retryMeta, retryQuestions] = await Promise.all([
        redisService.master.get(`exam:${examId}:meta`),
        redisService.master.get(`exam:${examId}:questions`),
      ]);
      if (retryMeta && retryQuestions) {
        return { meta: JSON.parse(retryMeta), questions: JSON.parse(retryQuestions) };
      }
      // If still missing, serve stale in-memory copy if available
      if (inMem) {
        return { meta: inMem.meta, questions: inMem.questions };
      }
    }

    // Fallback: direct load if everything else failed
    const directWarm = await this.warmExamCache(examId);
    const cached = this.inMemoryCache.get(examId)!;
    return { meta: cached.meta, questions: cached.questions };
  }
}

export const cacheService = new CacheService();
