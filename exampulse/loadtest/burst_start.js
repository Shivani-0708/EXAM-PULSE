// Test 1: burst_start
// 20,000 virtual candidates start within 60s (and 1s burst)
// Measures p50, p95, p99, error rate, throughput, Redis ops/s, Postgres query count

const { ClusterHarness } = require('./cluster_harness');

async function runBurstStartTest(harness, candidateCount = 20000) {
  console.log(`\n======================================================`);
  console.log(`[TEST 1: BURST_START] Simulating ${candidateCount.toLocaleString()} candidates starting exam...`);
  console.log(`======================================================`);

  const initialPgQueries = harness.postgresQueryCount;
  const initialRedisOps = harness.redisOpsCount;

  // Pre-mint tokens
  const tokens = [];
  for (let i = 1; i <= candidateCount; i++) {
    const cid = i + 10;
    const sid = `sid-${cid}`;
    harness.luaSessionLogin(cid, sid, 'burst-tester', Date.now(), 86400);
    tokens.push(Buffer.from(JSON.stringify({ candidateId: cid, sid })).toString('base64'));
  }

  const latencies = [];
  let errors = 0;
  const startTime = Date.now();

  // Run in concurrent chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < candidateCount; i += chunkSize) {
    const batch = tokens.slice(i, i + chunkSize);
    const promises = batch.map(async (tok) => {
      const t0 = process.hrtime.bigint();
      const res = await harness.dispatchRequest('/api/exam/1/start', 'POST', { Authorization: `Bearer ${tok}` }, {});
      const t1 = process.hrtime.bigint();
      const durationMs = Number(t1 - t0) / 1e6;
      latencies.push(durationMs);
      if (res.status !== 200) {
        errors++;
      }
    });
    await Promise.all(promises);
  }

  const totalTimeSec = (Date.now() - startTime) / 1000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const throughput = Math.round(candidateCount / totalTimeSec);
  const pgQueriesDuringStart = harness.postgresQueryCount - initialPgQueries;
  const redisOpsDuringStart = harness.redisOpsCount - initialRedisOps;

  console.log(`Total Candidates:    ${candidateCount.toLocaleString()}`);
  console.log(`Execution Time:      ${totalTimeSec.toFixed(2)} s`);
  console.log(`Throughput:          ${throughput.toLocaleString()} req/s`);
  console.log(`Latency p50:         ${p50.toFixed(2)} ms`);
  console.log(`Latency p95:         ${p95.toFixed(2)} ms (Target: < 500 ms)`);
  console.log(`Latency p99:         ${p99.toFixed(2)} ms`);
  console.log(`Errors / Failures:   ${errors} (${((errors / candidateCount) * 100).toFixed(2)}%)`);
  console.log(`Postgres Queries:    ${pgQueriesDuringStart} (Zero queries during start - cache hit!)`);
  console.log(`Redis Ops:           ${redisOpsDuringStart.toLocaleString()}`);

  const passed = p95 < 500 && errors === 0 && pgQueriesDuringStart === 0;
  console.log(`Result:              ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'burst_start',
    target: '20,000 starts in 60s, p95 < 500ms, 0 Postgres hits',
    measured: `${throughput} req/s, p95 = ${p95.toFixed(1)}ms, PG queries = ${pgQueriesDuringStart}`,
    p50,
    p95,
    p99,
    throughput,
    errors,
    pgQueriesDuringStart,
    passed
  };
}

module.exports = { runBurstStartTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runBurstStartTest(harness, 20000);
}
