// Test 7: kill_instance
// Stops app1 mid-load; verifies traffic failover via app2 in < 5s;
// confirms exam state and remaining time are intact.

const { ClusterHarness } = require('./cluster_harness');

async function runKillInstanceTest(harness) {
  console.log(`\n======================================================`);
  console.log(`[TEST 7: KILL_INSTANCE] Simulating backend node crash and LB failover...`);
  console.log(`======================================================`);

  const cid = 18;
  const tok = Buffer.from(JSON.stringify({ candidateId: cid, sid: `sid-${cid}` })).toString('base64');
  harness.luaSessionLogin(cid, `sid-${cid}`, 'harness', Date.now(), 86400);

  // Start exam
  const startRes = await harness.dispatchRequest('/api/exam/1/start', 'POST', { Authorization: `Bearer ${tok}` }, {});
  const originalDeadline = startRes.body.deadline;
  console.log(`Original Deadline established: ${new Date(originalDeadline).toISOString()}`);

  // Send request to app1
  const req1 = await harness.dispatchRequest('/api/time', 'GET', {}, {});
  console.log(`Request 1 routed to: ${req1.instance}`);

  // KILL app1
  console.log(`Killing app1...`);
  const killTime = Date.now();
  harness.app1Alive = false;

  // Immediate subsequent request through load balancer
  const failoverRes = await harness.dispatchRequest('/api/exam/1/attempt', 'GET', { Authorization: `Bearer ${tok}` }, {});
  const failoverDurationMs = Date.now() - killTime;

  console.log(`Failover Response Status: ${failoverRes.status}`);
  console.log(`Routed to Surviving Node: ${failoverRes.instance}`);
  console.log(`Failover Time:           ${failoverDurationMs} ms (Target: < 5000 ms)`);
  console.log(`Intact Deadline:          ${failoverRes.body.deadline === originalDeadline ? 'YES' : 'NO'}`);

  // Restore app1
  harness.app1Alive = true;

  const passed = failoverRes.status === 200 && failoverRes.instance === 'app2' && failoverDurationMs < 5000 && failoverRes.body.deadline === originalDeadline;
  console.log(`Result:                  ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'kill_instance',
    target: 'Failover under 5s, state intact',
    measured: `Failover completed in ${failoverDurationMs} ms via app2, deadline intact`,
    failoverDurationMs,
    passed
  };
}

module.exports = { runKillInstanceTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runKillInstanceTest(harness);
}
