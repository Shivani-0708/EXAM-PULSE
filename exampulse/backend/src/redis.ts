// Redis client and Lua script management for ExamPulse
import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from './config';

export class RedisService {
  public master: Redis;
  public subscriber: Redis;
  private luaScripts: Map<string, { code: string; sha: string }> = new Map();
  private isConnected = false;

  constructor() {
    this.master = new Redis({
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });

    this.subscriber = new Redis({
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return;
    await Promise.all([this.master.connect(), this.subscriber.connect()]);
    this.isConnected = true;
    await this.loadLuaScripts();
  }

  private async loadLuaScripts(): Promise<void> {
    const luaDir = path.join(__dirname, 'lua');
    const files = ['session_login.lua', 'rate_limit.lua', 'exam_start.lua', 'autosave.lua', 'final_submit.lua', 'heartbeat.lua'];

    for (const file of files) {
      const scriptPath = path.join(luaDir, file);
      if (fs.existsSync(scriptPath)) {
        const code = fs.readFileSync(scriptPath, 'utf8');
        const sha = crypto.createHash('sha1').update(code).digest('hex');
        try {
          const loadedSha = await this.master.script('LOAD', code);
          this.luaScripts.set(file, { code, sha: (loadedSha as string) || sha });
        } catch {
          this.luaScripts.set(file, { code, sha });
        }
      }
    }
  }

  private async evalScript(scriptName: string, numKeys: number, keys: string[], args: (string | number)[]): Promise<any> {
    const script = this.luaScripts.get(scriptName);
    if (!script) {
      throw new Error(`Lua script ${scriptName} not loaded`);
    }

    try {
      return await this.master.evalsha(script.sha, numKeys, ...keys, ...args.map(String));
    } catch (err: any) {
      if (err.message && err.message.includes('NOSCRIPT')) {
        return await this.master.eval(script.code, numKeys, ...keys, ...args.map(String));
      }
      throw err;
    }
  }

  /**
   * Executes Redis WAIT command to guarantee replica acknowledgment.
   * If durabilityMode is 'aof_wait', blocks until at least 1 replica acknowledges.
   */
  public async executeWait(): Promise<boolean> {
    if (config.durabilityMode !== 'aof_wait') {
      return true;
    }
    try {
      const acknowledged = await this.master.wait(1, config.waitTimeoutMs);
      return acknowledged >= 1;
    } catch (err) {
      console.warn(`[Redis WAIT warning] Replica acknowledgment timed out after ${config.waitTimeoutMs}ms`, err);
      return false;
    }
  }

  // --- Core Lua script wrappers ---

  public async sessionLogin(
    candidateId: number,
    sid: string,
    deviceInfo: string,
    serverNow: number,
    ttlSeconds: number
  ): Promise<{ replaced: boolean; oldSid: string }> {
    const key = `session:${candidateId}`;
    const res = await this.evalScript('session_login.lua', 1, [key], [candidateId, sid, deviceInfo, serverNow, ttlSeconds]);
    return {
      replaced: res[0] === 1,
      oldSid: res[1] || '',
    };
  }

  public async rateLimit(
    key: string,
    capacity: number,
    refillRate: number,
    requested: number,
    serverNow: number
  ): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
    const res = await this.evalScript('rate_limit.lua', 1, [`ratelimit:${key}`], [capacity, refillRate, requested, serverNow]);
    return {
      allowed: res[0] === 1,
      remaining: res[1],
      retryAfterMs: res[2],
    };
  }

  public async examStart(
    examId: number,
    candidateId: number,
    questionOrderJson: string,
    durationMinutes: number,
    hardEndMs: number
  ): Promise<{ isNew: boolean; startedAt: number; deadline: number; questionOrder: number[]; status: string }> {
    const attemptKey = `attempt:${examId}:${candidateId}`;
    const statusKey = `status:${examId}:${candidateId}`;
    const res = await this.evalScript('exam_start.lua', 2, [attemptKey, statusKey], [
      examId,
      candidateId,
      questionOrderJson,
      durationMinutes,
      hardEndMs,
    ]);

    return {
      isNew: res[0] === 1,
      startedAt: parseInt(res[1], 10),
      deadline: parseInt(res[2], 10),
      questionOrder: JSON.parse(res[3]),
      status: res[4],
    };
  }

  public async autosave(
    examId: number,
    candidateId: number,
    questionId: number,
    answer: string,
    version: number,
    clientTs: number,
    graceMs: number
  ): Promise<{ status: string; version: number; serverTs: number; answeredCount: number }> {
    const attemptKey = `attempt:${examId}:${candidateId}`;
    const answersKey = `answers:${examId}:${candidateId}`;
    const statusKey = `status:${examId}:${candidateId}`;

    const res = await this.evalScript('autosave.lua', 3, [attemptKey, answersKey, statusKey], [
      examId,
      candidateId,
      questionId,
      answer,
      version,
      clientTs,
      graceMs,
    ]);

    return {
      status: res[0],
      version: res[1],
      serverTs: parseInt(res[2], 10),
      answeredCount: res[3] || 0,
    };
  }

  public async finalSubmit(
    examId: number,
    candidateId: number,
    idempotencyKey: string,
    graceMs: number,
    clientTs: number
  ): Promise<{ status: string; result: any }> {
    const attemptKey = `attempt:${examId}:${candidateId}`;
    const submissionKey = `submission:${examId}:${candidateId}`;
    const answersKey = `answers:${examId}:${candidateId}`;
    const statusKey = `status:${examId}:${candidateId}`;
    const idemKey = `idem:${idempotencyKey}`;

    const res = await this.evalScript('final_submit.lua', 5, [attemptKey, submissionKey, answersKey, statusKey, idemKey], [
      examId,
      candidateId,
      idempotencyKey,
      graceMs,
      clientTs,
    ]);

    const parsedResult = typeof res[1] === 'string' ? JSON.parse(res[1]) : res[1];
    return {
      status: res[0],
      result: parsedResult,
    };
  }

  public async heartbeat(
    examId: number,
    candidateId: number,
    tabSwitchesDelta: number,
    serverNow: number
  ): Promise<{ state: string; lastSeen: number; tabSwitches: number; answeredCount: number }> {
    const statusKey = `status:${examId}:${candidateId}`;
    const heartbeatsKey = `heartbeats:${examId}`;

    const res = await this.evalScript('heartbeat.lua', 2, [statusKey, heartbeatsKey], [
      examId,
      candidateId,
      tabSwitchesDelta,
      serverNow,
    ]);

    return {
      state: res[0],
      lastSeen: res[1],
      tabSwitches: res[2],
      answeredCount: res[3],
    };
  }

  /**
   * Acquire a single-flight Redis lock with NX PX
   */
  public async acquireLock(key: string, lockVal: string, ttlMs: number): Promise<boolean> {
    const res = await this.master.set(key, lockVal, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }

  public async releaseLock(key: string, lockVal: string): Promise<boolean> {
    const lua = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    const res = await this.master.eval(lua, 1, key, lockVal);
    return res === 1;
  }

  /**
   * Authoritative server time via Redis TIME
   */
  public async getServerTimeMs(): Promise<number> {
    try {
      const [sec, micro] = await this.master.time();
      return parseInt(sec, 10) * 1000 + Math.floor(parseInt(micro, 10) / 1000);
    } catch {
      return Date.now();
    }
  }

  public async close(): Promise<void> {
    await Promise.all([this.master.quit(), this.subscriber.quit()]);
    this.isConnected = false;
  }
}

export const redisService = new RedisService();
