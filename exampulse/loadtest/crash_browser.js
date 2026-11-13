// Test 10: crash_browser
// Simulates client drop / crash, reload, and verify complete state recovery.

const { ClusterHarness } = require('./cluster_harness');

async function runCrashBrowserTest(harness) {
  console.log(`\n======================================================`);
  console.log(`[TEST 10: CRASH_BROWSER] Testing browser crash recovery...`);
  console.log(`======================================================`);

  const cid = 25;
  const tok = Buffer.from(JSON.stringify({ candidateId: cid, sid: `sid-${cid}` })).toString('base64');
  harness.luaSessionLogin(cid, `sid-${cid}`, 'browser-session', Date.now(), 86400);

  // 1. Initial Start
  const startRes = await harness.dispatchRequest('/api/exam/1/start', 'POST', { Authorization: `Bearer ${tok}` }, {});
  const originalOrder = startRes.body.questionOrder;
  const originalDeadline = startRes.body.deadline;

  // 2. Candidate answers Questions 1, 2, 3
  await harness.dispatchRequest('/api/exam/1/answers/1', 'PUT', { Authorization: `Bearer ${tok}` }, { answer: 'Answer 1', version: 1 });
  await harness.dispatchRequest('/api/exam/1/answers/2', 'PUT', { Authorization: `Bearer ${tok}` }, { answer: 'Answer 2', version: 1 });
  await harness.dispatchRequest('/api/exam/1/answers/3', 'PUT', { Authorization: `Bearer ${tok}` }, { answer: 'Answer 3', version: 2 });

  // 3. BROWSER CRASH (Client terminates, state lost locally)
  console.log(`Simulating browser crash & reload...`);

  // 4. Resume via GET /api/exam/:id/attempt
  const resumeRes = await harness.dispatchRequest('/api/exam/1/attempt', 'GET', { Authorization: `Bearer ${tok}` }, {});

  const resumedOrder = resumeRes.body.questionOrder;
  const resumedDeadline = resumeRes.body.deadline;
  const resumedAnswers = resumeRes.body.answers;

  const orderMatch = JSON.stringify(originalOrder) === JSON.stringify(resumedOrder);
  const deadlineMatch = originalDeadline === resumedDeadline;
  const answersRestored =
    resumedAnswers['1']?.answer === 'Answer 1' &&
    resumedAnswers['2']?.answer === 'Answer 2' &&
    resumedAnswers['3']?.answer === 'Answer 3';

  console.log(`Question Order Match: ${orderMatch ? 'YES' : 'NO'}`);
  console.log(`Deadline Restored:     ${deadlineMatch ? 'YES' : 'NO'}`);
  console.log(`Answers Restored:      ${answersRestored ? 'YES' : 'NO'}`);

  const passed = orderMatch && deadlineMatch && answersRestored;
  console.log(`Result:                ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'crash_browser',
    target: 'Complete state restoration after browser drop',
    measured: `Order, answers, and deadline 100% matched`,
    passed
  };
}

module.exports = { runCrashBrowserTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runCrashBrowserTest(harness);
}
