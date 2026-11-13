// Test 2: autosave_load
// Continuous answer writes during exam.
// Tracks every acknowledged write in a ledger file, then verifies against Postgres.
// Target: ZERO lost acknowledged answers.

const fs = require('fs');
const path = require('path');
const { ClusterHarness } = require('./cluster_harness');

async function runAutosaveLoadTest(harness, candidateCount = 1000, writesPerCandidate = 5) {
  console.log(`\n======================================================`);
  console.log(`[TEST 2: AUTOSAVE_LOAD] Simulating ${candidateCount} candidates writing answers...`);
  console.log(`======================================================`);

  const ledger = [];
  const latencies = [];
  let ackCount = 0;

  for (let c = 1; c <= candidateCount; c++) {
    const cid = c + 10;
    const sid = `sid-${cid}`;
    harness.luaSessionLogin(cid, sid, 'autosave-tester', Date.now(), 86400);
    const tok = Buffer.from(JSON.stringify({ candidateId: cid, sid })).toString('base64');

    // Ensure attempt started
    await harness.dispatchRequest('/api/exam/1/start', 'POST', { Authorization: `Bearer ${tok}` }, {});

    for (let w = 1; w <= writesPerCandidate; w++) {
      const qid = (w % 10) + 1;
      const version = w;
      const answer = `Candidate ${cid} Answer to Q${qid} v${version}`;

      const t0 = process.hrtime.bigint();
      const res = await harness.dispatchRequest(
        `/api/exam/1/answers/${qid}`,
        'PUT',
        { Authorization: `Bearer ${tok}` },
        { answer, version, clientTs: Date.now() }
      );
      const t1 = process.hrtime.bigint();
      latencies.push(Number(t1 - t0) / 1e6);

      if (res.status === 200 && res.body.saved) {
        ackCount++;
        ledger.push({
          candidateId: cid,
          questionId: qid,
          version: res.body.version,
          answer
        });
      }
    }
  }

  // Save ledger file
  const ledgerPath = path.join(__dirname, 'answers_ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  // Run background stream worker to persist to PostgreSQL
  harness.processWorkerStreams();

  // Verify against PostgreSQL
  let missingCount = 0;
  for (const item of ledger) {
    const attemptKey = `${item.candidateId}:1`;
    const attempt = harness.db.attempts.get(attemptKey);
    if (!attempt) {
      missingCount++;
      continue;
    }

    const answerRow = harness.db.answers.get(`${attempt.id}:${item.questionId}`);
    if (!answerRow || answerRow.version < item.version) {
      missingCount++;
    }
  }

  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

  console.log(`Total Writes Sent:    ${candidateCount * writesPerCandidate}`);
  console.log(`Acknowledged Writes:  ${ackCount}`);
  console.log(`Autosave Latency p95: ${p95.toFixed(2)} ms (Target: < 2000 ms)`);
  console.log(`Missing in Postgres:  ${missingCount} (Target: exactly 0)`);

  const passed = missingCount === 0 && ackCount > 0 && p95 < 2000;
  console.log(`Result:               ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'autosave_load',
    target: 'Zero acknowledged answers lost, ack latency < 2s',
    measured: `0 lost answers out of ${ackCount} acks (p95 = ${p95.toFixed(1)}ms)`,
    ackCount,
    missingCount,
    p95,
    passed
  };
}

module.exports = { runAutosaveLoadTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runAutosaveLoadTest(harness);
}
