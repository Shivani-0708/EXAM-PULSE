// AI Service Client with Circuit Breaker and Rule-Based Fallback
import http from 'http';
import { config } from '../config';
import { ruleFallbackService, CollusionResult } from './ruleFallback';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class AiServiceClient {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private readonly failureThreshold = 3;
  private lastFailureTime = 0;
  private readonly resetTimeoutMs = 15000; // 15 seconds

  public getCircuitState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  public isAiAvailable(): boolean {
    return this.getCircuitState() !== 'OPEN';
  }

  private recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.warn(`[Circuit Breaker] AI service tripped OPEN due to ${this.failureCount} consecutive failures. Using Rule Fallback.`);
    }
  }

  /**
   * Request collusion analysis from AI Service (Python FastAPI).
   * Automatically trips circuit breaker on timeout (>1s) or connection refusal,
   * falling back immediately to RuleFallbackService.
   */
  public async analyzeCollusion(
    targetCandidateId: number,
    candidatesData: any[]
  ): Promise<CollusionResult> {
    if (!this.isAiAvailable()) {
      return ruleFallbackService.analyzeCandidate(targetCandidateId, candidatesData);
    }

    try {
      const payload = JSON.stringify({
        targetCandidateId,
        candidates: candidatesData,
      });

      const responseText = await new Promise<string>((resolve, reject) => {
        const url = new URL('/analyze', config.aiServiceUrl);
        const req = http.request(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
            timeout: config.aiTimeoutMs,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(data);
              } else {
                reject(new Error(`AI HTTP ${res.statusCode}: ${data}`));
              }
            });
          }
        );

        req.on('timeout', () => {
          req.destroy(new Error(`AI service timeout (${config.aiTimeoutMs}ms)`));
        });
        req.on('error', (err) => reject(err));
        req.write(payload);
        req.end();
      });

      this.recordSuccess();
      const parsed = JSON.parse(responseText);
      return {
        ...parsed,
        method: 'AI_MODEL',
      };
    } catch (err: any) {
      console.warn(`[AI Service Call Failed] ${err.message}. Engaging fallback.`);
      this.recordFailure();
      return ruleFallbackService.analyzeCandidate(targetCandidateId, candidatesData);
    }
  }
}

export const aiServiceClient = new AiServiceClient();
