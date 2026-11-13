// Prometheus-Compatible Metrics Endpoint
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisService } from '../redis';
import { config } from '../config';

// In-memory counters and latency metrics
export const metricsData = {
  requestsTotal: 0,
  requestsByStatus: new Map<number, number>(),
  autosaveAcksTotal: 0,
  waitFailuresTotal: 0,
  submissionsTotal: 0,
  latencyBucketsMs: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  latencyHistogram: new Map<number, number>(),
};

// Initialize histogram buckets
for (const b of metricsData.latencyBucketsMs) {
  metricsData.latencyHistogram.set(b, 0);
}

export function recordLatency(durationMs: number) {
  metricsData.requestsTotal++;
  for (const b of metricsData.latencyBucketsMs) {
    if (durationMs <= b) {
      metricsData.latencyHistogram.set(b, (metricsData.latencyHistogram.get(b) || 0) + 1);
    }
  }
}

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', async (_req: FastifyRequest, reply: FastifyReply) => {
    let answerStreamLength = 0;
    let submitStreamLength = 0;

    try {
      [answerStreamLength, submitStreamLength] = await Promise.all([
        redisService.master.xlen('stream:answers'),
        redisService.master.xlen('stream:submissions'),
      ]);
    } catch {
      // Redis unavailable or empty
    }

    const lines: string[] = [
      '# HELP exampulse_requests_total Total number of HTTP requests processed',
      '# TYPE exampulse_requests_total counter',
      `exampulse_requests_total{instance="${config.instanceId}"} ${metricsData.requestsTotal}`,
      '',
      '# HELP exampulse_autosave_acks_total Total successful autosaves acknowledged',
      '# TYPE exampulse_autosave_acks_total counter',
      `exampulse_autosave_acks_total{instance="${config.instanceId}"} ${metricsData.autosaveAcksTotal}`,
      '',
      '# HELP exampulse_wait_failures_total Total Redis replica WAIT timeout failures',
      '# TYPE exampulse_wait_failures_total counter',
      `exampulse_wait_failures_total{instance="${config.instanceId}"} ${metricsData.waitFailuresTotal}`,
      '',
      '# HELP exampulse_submissions_total Total exam submissions processed',
      '# TYPE exampulse_submissions_total counter',
      `exampulse_submissions_total{instance="${config.instanceId}"} ${metricsData.submissionsTotal}`,
      '',
      '# HELP exampulse_stream_lag Number of unconsumed messages in Redis Streams',
      '# TYPE exampulse_stream_lag gauge',
      `exampulse_stream_lag{stream="stream:answers"} ${answerStreamLength}`,
      `exampulse_stream_lag{stream="stream:submissions"} ${submitStreamLength}`,
      '',
      '# HELP exampulse_request_duration_ms Request duration histogram',
      '# TYPE exampulse_request_duration_ms histogram',
    ];

    for (const [bucket, count] of metricsData.latencyHistogram.entries()) {
      lines.push(`exampulse_request_duration_ms_bucket{le="${bucket}"} ${count}`);
    }
    lines.push(`exampulse_request_duration_ms_bucket{le="+Inf"} ${metricsData.requestsTotal}`);
    lines.push(`exampulse_request_duration_ms_count ${metricsData.requestsTotal}`);

    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return reply.send(lines.join('\n'));
  });
}
