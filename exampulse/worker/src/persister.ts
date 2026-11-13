// Redis Stream Consumer: Answer Persister
// Consumes stream:answers via consumer group 'persisters' and upserts into PostgreSQL.
// Uses version gating: WHERE excluded.version > answers.version to prevent lost updates.
// Uses XAUTOCLAIM to safely recover pending unacked messages if a worker crashes.

import Redis from 'ioredis';
import { Pool } from 'pg';

export class AnswerPersister {
  private redis: Redis;
  private pool: Pool;
  private workerId: string;
  private stream = 'stream:answers';
  private group = 'persisters';
  private isRunning = false;

  constructor(redis: Redis, pool: Pool, workerId: string) {
    this.redis = redis;
    this.pool = pool;
    this.workerId = workerId;
  }

  public async init(): Promise<void> {
    try {
      // Create consumer group if not already present
      await this.redis.xgroup('CREATE', this.stream, this.group, '0', 'MKSTREAM');
      console.log(`[AnswerPersister] Consumer group '${this.group}' created on '${this.stream}'`);
    } catch (err: any) {
      if (!err.message.includes('BUSYGROUP')) {
        console.error('[AnswerPersister] Error creating consumer group:', err);
      }
    }
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[AnswerPersister ${this.workerId}] Stream consumer loop started.`);

    while (this.isRunning) {
      try {
        // 1. Recover pending messages from dead or hung workers using XAUTOCLAIM
        // Messages pending for more than 10,000ms are claimed by this worker
        await this.claimAndProcessStaleMessages();

        // 2. Read new messages from stream:answers
        const response = (await this.redis.xreadgroup(
          'GROUP',
          this.group,
          this.workerId,
          'BLOCK',
          2000,
          'COUNT',
          100,
          'STREAMS',
          this.stream,
          '>'
        )) as any;

        if (response && response.length > 0) {
          const streamData = response[0];
          const messages = streamData[1];
          if (messages && messages.length > 0) {
            await this.processMessageBatch(messages);
          }
        }
      } catch (err: any) {
        if (this.isRunning) {
          console.error(`[AnswerPersister ${this.workerId}] Error in loop:`, err.message);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  private async claimAndProcessStaleMessages(): Promise<void> {
    try {
      const claimResult = (await (this.redis as any).xautoclaim(
        this.stream,
        this.group,
        this.workerId,
        10000, // min idle time: 10s
        '0-0',
        'COUNT',
        50
      )) as any;

      if (claimResult && claimResult[1] && claimResult[1].length > 0) {
        const staleMessages = claimResult[1];
        console.log(`[AnswerPersister ${this.workerId}] XAUTOCLAIM recovered ${staleMessages.length} stale messages.`);
        await this.processMessageBatch(staleMessages);
      }
    } catch (err: any) {
      // Ignore if xautoclaim has empty stream or unsupported sub-argument
    }
  }

  private async processMessageBatch(messages: any[]): Promise<void> {
    const client = await this.pool.connect();
    const ackIds: string[] = [];

    try {
      await client.query('BEGIN');

      for (const msg of messages) {
        const id = msg[0];
        const fields = msg[1];
        const record: Record<string, string> = {};

        for (let i = 0; i < fields.length; i += 2) {
          record[fields[i]] = fields[i + 1];
        }

        const examId = parseInt(record.examId, 10);
        const candidateId = parseInt(record.candidateId, 10);
        const questionId = parseInt(record.questionId, 10);
        const answer = record.answer;
        const version = parseInt(record.version, 10);
        const clientTs = parseInt(record.clientTs || '0', 10);
        const serverTs = parseInt(record.serverTs || String(Date.now()), 10);

        // Fetch or create attempt ID
        const attemptRes = await client.query(
          'SELECT id FROM attempts WHERE candidate_id = $1 AND exam_id = $2 LIMIT 1',
          [candidateId, examId]
        );

        let attemptId: number;
        if (attemptRes.rows.length === 0) {
          // Attempt created on fly if missing in DB
          const insertAttempt = await client.query(
            `INSERT INTO attempts (exam_id, candidate_id, question_order, started_at, deadline, status)
             VALUES ($1, $2, '[]'::JSONB, TO_TIMESTAMP($3 / 1000.0), TO_TIMESTAMP(($3 + 3600000) / 1000.0), 'ACTIVE')
             ON CONFLICT (candidate_id, exam_id) DO UPDATE SET updated_at = NOW()
             RETURNING id`,
            [examId, candidateId, serverTs]
          );
          attemptId = insertAttempt.rows[0].id;
        } else {
          attemptId = attemptRes.rows[0].id;
        }

        // Version-gated upsert: ONLY updates if incoming version > existing version
        await client.query(
          `INSERT INTO answers (attempt_id, question_id, answer, version, client_ts, server_ts, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT (attempt_id, question_id) 
           DO UPDATE SET 
             answer = EXCLUDED.answer,
             version = EXCLUDED.version,
             client_ts = EXCLUDED.client_ts,
             server_ts = EXCLUDED.server_ts,
             updated_at = NOW()
           WHERE EXCLUDED.version > answers.version`,
          [attemptId, questionId, answer, version, clientTs, serverTs]
        );

        ackIds.push(id);
      }

      await client.query('COMMIT');

      // Acknowledge processed messages in Redis Stream
      if (ackIds.length > 0) {
        await this.redis.xack(this.stream, this.group, ...ackIds);
      }
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`[AnswerPersister ${this.workerId}] Batch commit failed:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  public stop(): void {
    this.isRunning = false;
  }
}
