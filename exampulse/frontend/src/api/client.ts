// API Client with NTP Time Synchronization and Session Handling

export interface TimeSyncResult {
  offset: number; // Add this to local Date.now() to get authoritative server time
  minRtt: number;
}

class ApiClient {
  private token: string | null = null;
  private serverOffset: number = 0;
  private onSessionReplacedCallback: (() => void) | null = null;

  constructor() {
    this.token = localStorage.getItem('exampulse_token');
  }

  public setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('exampulse_token', token);
    } else {
      localStorage.removeItem('exampulse_token');
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public onSessionReplaced(cb: () => void) {
    this.onSessionReplacedCallback = cb;
  }

  public async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      try {
        const body = await res.clone().json();
        if (body.error === 'SESSION_REPLACED') {
          if (this.onSessionReplacedCallback) {
            this.onSessionReplacedCallback();
          }
        }
      } catch {}
    }

    return res;
  }

  /**
   * NTP Time Synchronization
   * Samples /api/time multiple times, keeps the sample with lowest RTT,
   * and computes offset = serverNow - (tRequest + tResponse)/2.
   */
  public async syncServerTime(samples: number = 3): Promise<TimeSyncResult> {
    let lowestRtt = Infinity;
    let bestOffset = 0;

    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      try {
        const res = await fetch('/api/time');
        const t1 = Date.now();
        if (res.ok) {
          const data = await res.json();
          const rtt = t1 - t0;
          if (rtt < lowestRtt) {
            lowestRtt = rtt;
            const midpoint = t0 + rtt / 2;
            bestOffset = data.serverNow - midpoint;
          }
        }
      } catch (err) {
        console.warn('[Time Sync Sample Failed]', err);
      }
    }

    this.serverOffset = bestOffset;
    return { offset: bestOffset, minRtt: lowestRtt };
  }

  public getAuthoritativeNow(): number {
    return Date.now() + this.serverOffset;
  }

  public getServerOffset(): number {
    return this.serverOffset;
  }
}

export const api = new ApiClient();
