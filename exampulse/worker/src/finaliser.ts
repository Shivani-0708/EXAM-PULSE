// Redis Stream Consumer: Submission Finaliser and Auto-Grading Worker
// Consumes stream:submissions via consumer group 'finalisers'
// Writes submission record to PostgreSQL, auto-grades objective questions,
// updates Redis leaderboard:{examId} with deterministic tie-breaking formula:
// score * 1e9 + (1e9 - secondsTaken)

import Redis from 'ioredis';
import { Pool } from 'pg';

export class SubmissionFinaliser {
  private redis: Redis;
  private pool: Pool;
  private workerId: string;
  private stream = 'stream:submissions';
  private group = 'finalisers';
  private isRunning = false;

  constructor(redis: Redis, pool: Pool, workerId: string) {
    this.redis = redis;
    this.pool = pool;
    this.workerId = workerId;
  }

  public async init(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.stream, this.group, '0', 'MKSTREAM');
      console.log(`[SubmissionFinaliser] Consumer group '${this.group}' created on '${this.stream}'`);
    } catch (err: any) {
      if (!err.message.includes('BUSYGROUP')) {
        console.error('[SubmissionFinaliser] Error creating group:', err);
      }
    }
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[SubmissionFinaliser ${this.workerId}] Stream consumer loop started.`);

    while (this.isRunning) {
      try {
        const response = (await this.redis.xreadgroup(
          'GROUP',
          this.group,
          this.workerId,
          'BLOCK',
          2000,
          'COUNT',
          50,
          'STREAMS',
          this.stream,
          '>'
        )) as any;

        if (response && response.length > 0) {
          const messages = response[0][1];
          if (messages && messages.length > 0) {
            await this.processBatch(messages);
          }
        }
      } catch (err: any) {
        if (this.isRunning) {
          console.error(`[SubmissionFinaliser ${this.workerId}] Loop error:`, err.message);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  private async processBatch(messages: any[]): Promise<void> {
    const client = await this.pool.connect();
    const ackIds: string[] = [];

    try {
      await client.query('BEGIN');

      for (const msg of messages) {
        const msgId = msg[0];
        const fields = msg[1];
        const record: Record<string, string> = {};

        for (let i = 0; i < fields.length; i += 2) {
          record[fields[i]] = fields[i + 1];
        }

        const examId = parseInt(record.examId, 10);
        const candidateId = parseInt(record.candidateId, 10);
        const idempotencyKey = record.idempotencyKey;
        const status = record.status;
        const submittedAtMs = parseInt(record.submittedAt, 10);
        const secondsTaken = parseInt(record.secondsTaken || '0', 10);
        const snapshotHash = record.snapshotHash;

        // 1. Get attempt ID
        const attemptRes = await client.query(
          'SELECT id FROM attempts WHERE candidate_id = $1 AND exam_id = $2 LIMIT 1',
          [candidateId, examId]
        );

        if (attemptRes.rows.length === 0) {
          ackIds.push(msgId);
          continue;
        }

        const attemptId = attemptRes.rows[0].id;

        // 2. Insert into PostgreSQL submissions table
        await client.query(
          `INSERT INTO submissions (attempt_id, idempotency_key, status, submitted_at, answer_snapshot_hash, server_ts)
           VALUES ($1, $2, $3, TO_TIMESTAMP($4 / 1000.0), $5, $4)
           ON CONFLICT (attempt_id) DO NOTHING`,
          [attemptId, idempotencyKey, status, submittedAtMs, snapshotHash]
        );

        // Update attempt status to final status
        await client.query('UPDATE attempts SET status = $1 WHERE id = $2', [status, attemptId]);

        // 3. Auto-grade objective questions
        let score = 0;
        let maxScore = 0;

        const questionsRes = await client.query(
          'SELECT id, question_type, correct_answer, points FROM questions WHERE exam_id = $1',
          [examId]
        );

        const answersRes = await client.query('SELECT question_id, answer FROM answers WHERE attempt_id = $1', [
          attemptId,
        ]);

        const candidateAnswers = new Map<number, string>();
        for (const row of answersRes.rows) {
          candidateAnswers.set(row.question_id, row.answer?.trim() || '');
        }

        for (const q of questionsRes.rows) {
          const points = parseFloat(q.points) || 1.0;
          maxScore += points;
          const givenAnswer = candidateAnswers.get(q.id);

          if (q.question_type === 'mcq' && q.correct_answer && givenAnswer) {
            if (q.correct_answer.trim().toLowerCase() === givenAnswer.toLowerCase()) {
              score += points;
            }
          }
        }

        // 4. Update PostgreSQL results table
        await client.query(
          `INSERT INTO results (attempt_id, candidate_id, exam_id, score, max_score, seconds_taken)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (attempt_id) 
           DO UPDATE SET score = EXCLUDED.score, seconds_taken = EXCLUDED.seconds_taken`,
          [attemptId, candidateId, examId, score, maxScore, secondsTaken]
        );

        // 5. Update Redis Leaderboard with Deterministic Tie-Breaking Formula
        // compositeScore = score * 1e9 + (1e9 - secondsTaken)
        // Higher score ranks higher; if score ties, smaller secondsTaken yields larger remainder!
        const compositeScore = score * 1e9 + (1e9 - secondsTaken);
        await this.redis.zadd(`leaderboard:${examId}`, compositeScore, String(candidateId));

        // Cache candidate info in Redis for sub-50ms pipelined name lookup
        const candInfo = await client.query('SELECT candidate_number, name FROM candidates WHERE id = $1', [
          candidateId,
        ]);
        if (candInfo.rows.length > 0) {
          await this.redis.hmset(`candidate_info:${candidateId}`, {
            candidateNumber: candInfo.rows[0].candidate_number,
            name: candInfo.rows[0].name,
          });
        }

        ackIds.push(msgId);
      }

      await client.query('COMMIT');

      if (ackIds.length > 0) {
        await this.redis.xack(this.stream, this.group, ...ackIds);
      }
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`[SubmissionFinaliser ${this.workerId}] Batch failed:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  public stop(): void {
    this.isRunning = false;
  }
}
