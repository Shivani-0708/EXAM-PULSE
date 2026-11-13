// Test 9: leaderboard_bench
// Benchmarks Redis sorted set queries (ZREVRANGE / ZREVRANK)
// Target: p95 under 50 ms.

const { ClusterHarness } = require('./cluster_harness');

async function runLeaderboardBenchTest(harness, queryCount = 1000) {
  console.log(`\n======================================================`);
  console.log(`[TEST 9: LEADERBOARD_BENCH] Benchmarking ${queryCount} leaderboard queries...`);
  console.log(`======================================================`);

  // Ensure leaderboard has entries
  const zKey = 'leaderboard:1';
  if (!harness.redis.zsets.has(zKey)) {
    harness.redis.zsets.set(zKey, new Map());
  }
  for (let i = 1; i <= 500; i++) {
    const score = Math.floor(Math.random() * 10) * 1e9 + (1e9 - Math.floor(Math.random() * 3600));
    harness.redis.zsets.get(zKey).set(String(i + 10), score);
  }

  const latencies = [];

  for (let i = 0; i < queryCount; i++) {
    const t0 = process.hrtime.bigint();
    const res = await harness.dispatchRequest('/api/leaderboard?top=50', 'GET', {}, {});
    const t1 = process.hrtime.bigint();
    latencies.push(Number(t1 - t0) / 1e6);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  console.log(`Queries Run:  ${queryCount}`);
  console.log(`Latency p50:  ${p50.toFixed(2)} ms`);
  console.log(`Latency p95:  ${p95.toFixed(2)} ms (Target: < 50 ms)`);
  console.log(`Latency p99:  ${p99.toFixed(2)} ms`);

  const passed = p95 < 50;
  console.log(`Result:       ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'leaderboard_bench',
    target: 'Leaderboard query p95 under 50 ms',
    measured: `p50 = ${p50.toFixed(2)}ms, p95 = ${p95.toFixed(2)}ms`,
    p50,
    p95,
    p99,
    passed
  };
}

module.exports = { runLeaderboardBenchTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runLeaderboardBenchTest(harness);
}
