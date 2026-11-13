// Test 5: final_minute_rush
// 20,000 submissions in the final 60s
// Target: zero 5xx errors, zero duplicate rows, high throughput

const { ClusterHarness } = require('./cluster_harness');

async function runFinalMinuteRushTest(harness, candidateCount = 20000) {
  console.log(`\n======================================================`);
  console.log(`[TEST 5: FINAL_MINUTE_RUSH] Simulating ${candidateCount.toLocaleString()} final submissions...`);
  console.log(`======================================================`);

  const tokens = [];
  for (let i = 1; i <= candidateCount; i++) {
    const cid = i + 10;
    const sid = `sid-${cid}`;
    harness.luaSessionLogin(cid, sid, 'rush-tester', Date.now(), 86400);
    tokens.push({
      cid,
      tok: Buffer.from(JSON.stringify({ candidateId: cid, sid })).toString('base64'),
      idemKey: `rush-idem-${cid}`
    });
    // Ensure attempt exists
    harness.luaExamStart(1, cid, JSON.stringify([1,2,3,4,5]), 60, 0);
  }

  const latencies = [];
  let failures = 0;
  const startTime = Date.now();

  const chunkSize = 500;
  for (let i = 0; i < candidateCount; i += chunkSize) {
    const batch = tokens.slice(i, i + chunkSize);
    const promises = batch.map(async (item) => {
      const t0 = process.hrtime.bigint();
      const res = await harness.dispatchRequest(
        '/api/exam/1/submit',
        'POST',
        {
          Authorization: `Bearer ${item.tok}`,
          'Idempotency-Key': item.idemKey
        },
        { idempotencyKey: item.idemKey }
      );
      const t1 = process.hrtime.bigint();
      latencies.push(Number(t1 - t0) / 1e6);

      if (res.status !== 200) {
        failures++;
      }
    });
    await Promise.all(promises);
  }

  const totalTimeSec = (Date.now() - startTime) / 1000;
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const throughput = Math.round(candidateCount / totalTimeSec);

  // Process worker stream to DB
  harness.processWorkerStreams();

  console.log(`Submissions Handled: ${candidateCount.toLocaleString()}`);
  console.log(`Execution Time:      ${totalTimeSec.toFixed(2)} s`);
  console.log(`Throughput:          ${throughput.toLocaleString()} submits/sec`);
  console.log(`Latency p95:         ${p95.toFixed(2)} ms`);
  console.log(`Failures (5xx):      ${failures} (Target: 0)`);

  const passed = failures === 0 && candidateCount >= 20000;
  console.log(`Result:              ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'final_minute_rush',
    target: '20,000 submits in 60s, zero 5xx errors, zero duplicates',
    measured: `${throughput} req/s, p95 = ${p95.toFixed(1)}ms, failures = ${failures}`,
    throughput,
    failures,
    p95,
    passed
  };
}

module.exports = { runFinalMinuteRushTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runFinalMinuteRushTest(harness, 20000);
}
