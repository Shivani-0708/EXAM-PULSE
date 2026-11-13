// Test 4: duplicate_submit
const { ClusterHarness } = require('./cluster_harness');

async function runDuplicateSubmitTest(harness) {
  console.log(`\n======================================================`);
  console.log(`[TEST 4: DUPLICATE_SUBMIT] Testing concurrent submission idempotency...`);
  console.log(`======================================================`);

  const cid = 15;
  const sid = `sid-${cid}`;
  harness.luaSessionLogin(cid, sid, 'duplicate-tester', Date.now(), 86400);
  const tok = Buffer.from(JSON.stringify({ candidateId: cid, sid })).toString('base64');
  const idemKey = `idem-concurrent-test-${cid}`;

  // Start attempt and save an answer
  await harness.dispatchRequest('/api/exam/1/start', 'POST', { Authorization: `Bearer ${tok}` }, {});
  await harness.dispatchRequest('/api/exam/1/answers/1', 'PUT', { Authorization: `Bearer ${tok}` }, { answer: 'Consistency', version: 1 });

  // Fire 10 concurrent submission requests with the same Idempotency-Key
  const concurrentCalls = 10;
  const promises = [];
  for (let i = 0; i < concurrentCalls; i++) {
    promises.push(
      harness.dispatchRequest(
        '/api/exam/1/submit',
        'POST',
        {
          Authorization: `Bearer ${tok}`,
          'Idempotency-Key': idemKey
        },
        { idempotencyKey: idemKey }
      )
    );
  }

  const results = await Promise.all(promises);

  // Verify all responses are identical
  const firstOutcome = results[0].body?.outcome;
  const firstSnapshot = results[0].body?.submission?.snapshotHash;
  let allIdentical = true;

  for (const r of results) {
    if (r.body?.outcome !== firstOutcome || r.body?.submission?.snapshotHash !== firstSnapshot) {
      allIdentical = false;
    }
  }

  // Run worker to persist submission to Postgres
  harness.processWorkerStreams();

  // Verify Postgres has exactly 1 submission row
  const attempt = harness.db.attempts.get(`${cid}:1`);
  const submissionRows = attempt ? Array.from(harness.db.submissions.values()).filter(s => s.attempt_id === attempt.id) : [];

  console.log(`Concurrent Calls Sent: ${concurrentCalls}`);
  console.log(`Identical Responses:   ${allIdentical ? 'YES' : 'NO'}`);
  console.log(`Postgres Rows Created: ${submissionRows.length} (Target: exactly 1)`);
  console.log(`Outcome Status:        ${firstOutcome}`);

  // Test late submission rejection
  const lateCid = 16;
  const lateSid = `sid-${lateCid}`;
  harness.luaSessionLogin(lateCid, lateSid, 'late-tester', Date.now(), 86400);
  const lateTok = Buffer.from(JSON.stringify({ candidateId: lateCid, sid: lateSid })).toString('base64');
  await harness.dispatchRequest('/api/exam/1/start', 'POST', { Authorization: `Bearer ${lateTok}` }, {});

  // Artificially expire deadline in attempt hash
  const lateAttemptHash = harness.redis.hashes.get(`attempt:1:${lateCid}`);
  lateAttemptHash.set('deadline', String(Date.now() - 10000)); // expired 10s ago

  const lateRes = await harness.dispatchRequest(
    '/api/exam/1/submit',
    'POST',
    { Authorization: `Bearer ${lateTok}`, 'Idempotency-Key': `idem-late-${lateCid}` },
    {}
  );

  console.log(`Late Submission Outcome: ${lateRes.body?.outcome} (Expected: REJECTED_LATE)`);

  const passed = allIdentical && submissionRows.length === 1 && lateRes.body?.outcome === 'REJECTED_LATE';
  console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'duplicate_submit',
    target: '1 submission row, identical concurrent responses, late reject',
    measured: `1 row in DB, identical=${allIdentical}, lateOutcome=${lateRes.body?.outcome}`,
    passed
  };
}

module.exports = { runDuplicateSubmitTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runDuplicateSubmitTest(harness);
}
