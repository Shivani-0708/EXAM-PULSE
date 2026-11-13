// Server-Authoritative Timer Service for ExamPulse
import { redisService } from '../redis';
import { config } from '../config';

export class TimerService {
  /**
   * Returns authoritative server timestamp in ms via Redis TIME.
   */
  public async getServerNow(): Promise<number> {
    return await redisService.getServerTimeMs();
  }

  /**
   * Validates if the current server time is within the allowed attempt deadline + graceMs.
   */
  public async isWithinDeadline(deadlineMs: number, graceMs: number = config.defaultGraceMs): Promise<{ valid: boolean; serverNow: number; remainingMs: number }> {
    const serverNow = await this.getServerNow();
    const remainingMs = deadlineMs + graceMs - serverNow;
    return {
      valid: remainingMs >= 0,
      serverNow,
      remainingMs: Math.max(0, remainingMs),
    };
  }
}

export const timerService = new TimerService();
