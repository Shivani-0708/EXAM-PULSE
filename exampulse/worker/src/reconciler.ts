// Periodic Reconciler: Audits Redis write buffer against PostgreSQL source of record
// Detects any missed writes or discrepancies and repairs Postgres automatically

import Redis from 'ioredis';
import { Pool } from 'pg';

export class AnswerReconciler {
  private redis: Redis;
  private pool: Pool;
  private isRunning = false;
  private intervalMs: number;

  constructor(redis: Redis, pool: Pool, intervalMs: number = 30000) {
    this.redis = redis;
    this.pool = pool;
    this.intervalMs = intervalMs;
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[AnswerReconciler] Periodic reconciler started (interval: ${this.intervalMs}ms).`);

    while (this.isRunning) {
      try {
        await new Promise((r) => setTimeout(r, this.intervalMs));
        if (!this.isRunning) break;
        await this.runReconciliationCycle();
      } catch (err: any) {
        console.error('[AnswerReconciler] Reconciliation cycle error:', err.message);
      }
    }
  }

  public async runReconciliationCycle(): Promise<{ scanned: number; repaired: number }> {
    let scanned = 0;
    let repaired = 0;

    // Scan for answer keys in Redis: answers:1:*
    let cursor = '0';
    const answerKeys: string[] = [];

    do {
      const res = await this.redis.scan(cursor, 'MATCH', 'answers:*:*', 'COUNT', 100);
      cursor = res[0];
      answerKeys.push(...res[1]);
    } while (cursor !== '0');

    if (answerKeys.length === 0) {
      return { scanned: 0, repaired: 0 };
    }

    const client = await this.pool.connect();
    try {
      for (const key of answerKeys) {
        scanned++;
        const parts = key.split(':');
        const examId = parseInt(parts[1], 10);
        const candidateId = parseInt(parts[2], 10);

        const redisAnswers = await this.redis.hgetall(key);
        if (!redisAnswers || Object.keys(redisAnswers).length === 0) continue;

        // Get attempt ID from PostgreSQL
        const attemptRes = await client.query(
          'SELECT id FROM attempts WHERE candidate_id = $1 AND exam_id = $2 LIMIT 1',
          [candidateId, examId]
        );

        if (attemptRes.rows.length === 0) continue;
        const attemptId = attemptRes.rows[0].id;

        // Fetch PostgreSQL answers for this attempt
        const pgAnswersRes = await client.query(
          'SELECT question_id, version FROM answers WHERE attempt_id = $1',
          [attemptId]
        );

        const pgVersionMap = new Map<number, number>();
        for (const row of pgAnswersRes.rows) {
          pgVersionMap.set(row.question_id, row.version);
        }

        // Check for missing questions or older versions in PostgreSQL
        for (const [qidStr, val] of Object.entries(redisAnswers)) {
          const qid = parseInt(qidStr, 10);
          try {
            const parsed = JSON.parse(val);
            const rVersion = parseInt(parsed.version || '1', 10);
            const pgVersion = pgVersionMap.get(qid);

            if (pgVersion === undefined || rVersion > pgVersion) {
              // Repair needed: upsert Redis state into PostgreSQL
              await client.query(
                `INSERT INTO answers (attempt_id, question_id, answer, version, client_ts, server_ts, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (attempt_id, question_id) 
                 DO UPDATE SET 
                   answer = EXCLUDED.answer,
                   version = EXCLUDED.version,
                   client_ts = EXCLUDED.client_ts,
                   server_ts = EXCLUDED.server_ts,
                   updated_at = NOW()
                 WHERE EXCLUDED.version > answers.version`,
                [attemptId, qid, parsed.answer || '', rVersion, parsed.clientTs || 0, parsed.serverTs || Date.now()]
              );
              repaired++;
            }
          } catch {}
        }
      }
    } finally {
      client.release();
    }

    if (repaired > 0) {
      console.log(`[AnswerReconciler] Cycle completed: Scanned ${scanned} candidates, repaired ${repaired} answers.`);
    }

    return { scanned, repaired };
  }

  public stop(): void {
    this.isRunning = false;
  }
}
