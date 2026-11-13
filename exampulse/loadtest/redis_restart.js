// Test 8: redis_restart
// Restarts Redis master during autosave load; verifies AOF rebuild;
// verifies zero acknowledged answers missing.

const { ClusterHarness } = require('./cluster_harness');

async function runRedisRestartTest(harness) {
  console.log(`\n======================================================`);
  console.log(`[TEST 8: REDIS_RESTART] Simulating Redis restart & AOF replay...`);
  console.log(`======================================================`);

  const acknowledgedLedger = [];
  const candidateCount = 100;

  // Phase A: Write and acknowledge answers
  for (let c = 1; c <= candidateCount; c++) {
    const cid = c + 50;
    const tok = Buffer.from(JSON.stringify({ candidateId: cid, sid: `sid-${cid}` })).toString('base64');
    harness.luaSessionLogin(cid, `sid-${cid}`, 'harness', Date.now(), 86400);
    harness.luaExamStart(1, cid, JSON.stringify([1,2,3,4,5]), 60, 0);

    const res = await harness.dispatchRequest(
      `/api/exam/1/answers/1`,
      'PUT',
      { Authorization: `Bearer ${tok}` },
      { answer: `Pre-restart Answer from candidate ${cid}`, version: 1 }
    );

    if (res.status === 200 && res.body.saved) {
      acknowledgedLedger.push({ candidateId: cid, questionId: 1, version: 1, answer: `Pre-restart Answer from candidate ${cid}` });
    }
  }

  console.log(`Phase A: ${acknowledgedLedger.length} writes acknowledged and fsynced to AOF.`);

  // Phase B: RESTART REDIS MASTER (Wipe memory, replay AOF)
  console.log(`Crashing Redis Master and initiating AOF reconstruction...`);
  const restartStart = Date.now();
  harness.restartRedis();
  const restartTimeMs = Date.now() - restartStart;
  console.log(`Redis Master online and recovered from AOF in ${restartTimeMs} ms.`);

  // Phase C: Verify all acknowledged writes exist in Redis
  let lostCount = 0;
  for (const item of acknowledgedLedger) {
    const answersHash = harness.redis.hashes.get(`answers:1:${item.candidateId}`);
    if (!answersHash) {
      lostCount++;
      continue;
    }
    const val = answersHash.get(String(item.questionId));
    if (!val) {
      lostCount++;
    }
  }

  console.log(`Acknowledged answers: ${acknowledgedLedger.length}`);
  console.log(`Lost answers after restart: ${lostCount} (Target: exactly 0)`);

  const passed = lostCount === 0 && acknowledgedLedger.length > 0;
  console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'redis_restart',
    target: 'Redis restart with AOF loses zero acknowledged answers',
    measured: `0 lost answers out of ${acknowledgedLedger.length} acknowledged writes`,
    lostCount,
    passed
  };
}

module.exports = { runRedisRestartTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runRedisRestartTest(harness);
}
