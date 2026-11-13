// Presence Sweeper: Identifies silent candidates and flags them DISCONNECTED
// Uses Redis sorted set heartbeats:{examId} scored by lastSeen epoch ms

import Redis from 'ioredis';

export class HeartbeatSweeper {
  private redis: Redis;
  private isRunning = false;
  private intervalMs: number;
  private thresholdMs = 15000; // 15 seconds silent -> DISCONNECTED

  constructor(redis: Redis, intervalMs: number = 5000) {
    this.redis = redis;
    this.intervalMs = intervalMs;
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[HeartbeatSweeper] Heartbeat monitor started (interval: ${this.intervalMs}ms).`);

    while (this.isRunning) {
      try {
        await new Promise((r) => setTimeout(r, this.intervalMs));
        if (!this.isRunning) break;
        await this.sweepExam(1);
      } catch (err: any) {
        console.error('[HeartbeatSweeper] Error in sweep cycle:', err.message);
      }
    }
  }

  public async sweepExam(examId: number): Promise<number> {
    const [sec, micro] = await this.redis.time();
    const serverNow = parseInt(sec, 10) * 1000 + Math.floor(parseInt(micro, 10) / 1000);
    const cutoffTime = serverNow - this.thresholdMs;

    const zsetKey = `heartbeats:${examId}`;

    // Find all candidate IDs whose lastSeen < cutoffTime
    const disconnectedCandidates = await this.redis.zrangebyscore(zsetKey, '-inf', cutoffTime);
    if (!disconnectedCandidates || disconnectedCandidates.length === 0) {
      return 0;
    }

    let marked = 0;
    for (const cid of disconnectedCandidates) {
      const statusKey = `status:${examId}:${cid}`;
      const state = await this.redis.hget(statusKey, 'state');

      if (state === 'ACTIVE') {
        await this.redis.hset(statusKey, 'state', 'DISCONNECTED');
        marked++;

        // Notify dashboard fanout
        await this.redis.publish(
          `channel:dashboard:${examId}`,
          JSON.stringify({
            type: 'CANDIDATE_DISCONNECTED',
            candidateId: parseInt(cid, 10),
            timestamp: serverNow,
          })
        );
      }
    }

    return marked;
  }

  public stop(): void {
    this.isRunning = false;
  }
}
