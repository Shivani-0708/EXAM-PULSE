// Test 6: second_device
// Second login replaces first session and is audit-logged.
// Old device gets 401 SESSION_REPLACED on next request.

const { ClusterHarness } = require('./cluster_harness');

async function runSecondDeviceTest(harness) {
  console.log(`\n======================================================`);
  console.log(`[TEST 6: SECOND_DEVICE] Verifying single active session policy...`);
  console.log(`======================================================`);

  const email = 'candidate1@exampulse.io';

  // 1. First device login
  const login1 = await harness.dispatchRequest('/api/auth/login', 'POST', {}, {
    email,
    deviceInfo: 'Laptop-Chrome-MacOS'
  });
  const token1 = login1.body.token;
  console.log(`Device 1 Login OK: sid = ${login1.body.sid}`);

  // Device 1 starts exam
  const start1 = await harness.dispatchRequest('/api/exam/1/start', 'POST', { Authorization: `Bearer ${token1}` }, {});
  console.log(`Device 1 Start Exam: status = ${start1.status}`);

  // 2. Second device login from phone
  const login2 = await harness.dispatchRequest('/api/auth/login', 'POST', {}, {
    email,
    deviceInfo: 'Phone-Safari-iOS'
  });
  const token2 = login2.body.token;
  console.log(`Device 2 Login OK: sid = ${login2.body.sid}, replacedPreviousSession = ${login2.body.replacedPreviousSession}`);

  // 3. Device 1 attempts write -> Expected: 401 SESSION_REPLACED
  const staleAttempt = await harness.dispatchRequest(
    '/api/exam/1/answers/1',
    'PUT',
    { Authorization: `Bearer ${token1}` },
    { answer: 'Stale attempt', version: 2 }
  );

  console.log(`Device 1 Stale Request Status: ${staleAttempt.status} (Expected: 401)`);
  console.log(`Device 1 Error Code:          ${staleAttempt.body?.error || ''} (Expected: SESSION_REPLACED)`);

  // 4. Device 2 attempts write -> Expected: 200 OK
  const activeAttempt = await harness.dispatchRequest(
    '/api/exam/1/answers/1',
    'PUT',
    { Authorization: `Bearer ${token2}` },
    { answer: 'Consistency', version: 1 }
  );
  console.log(`Device 2 Active Request Status: ${activeAttempt.status} (Expected: 200)`);

  const passed =
    login2.body.replacedPreviousSession === true &&
    staleAttempt.status === 401 &&
    staleAttempt.body?.error === 'SESSION_REPLACED' &&
    activeAttempt.status === 200;

  console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'second_device',
    target: 'Second login invalidates first with 401 SESSION_REPLACED',
    measured: `Device 1 rejected with 401 SESSION_REPLACED, Device 2 accepted`,
    passed
  };
}

module.exports = { runSecondDeviceTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runSecondDeviceTest(harness);
}
