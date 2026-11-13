// Test 3: timer_skew
// Measure difference in computed remaining time across clients,
// including clients with clocks shifted by +/- 1 hour.
// Target: Skew under 1.0 second.

const { ClusterHarness } = require('./cluster_harness');

async function runTimerSkewTest(harness) {
  console.log(`\n======================================================`);
  console.log(`[TEST 3: TIMER_SKEW] Testing clock skew across tampered clients...`);
  console.log(`======================================================`);

  const serverDeadline = Date.now() + 3600 * 1000;

  // 4 Virtual Clients with different local clock skews
  const clients = [
    { name: 'Accurate Clock', localClockOffset: 0 },
    { name: 'Shifted +1 Hour', localClockOffset: +3600 * 1000 },
    { name: 'Shifted -1 Hour', localClockOffset: -3600 * 1000 },
    { name: 'Shifted +15 Mins', localClockOffset: +900 * 1000 },
  ];

  const computedRemainingTimes = [];

  for (const client of clients) {
    // Client simulates NTP sync with /api/time
    const t0 = Date.now() + client.localClockOffset;
    const res = await harness.dispatchRequest('/api/time', 'GET', {}, {});
    const t1 = Date.now() + client.localClockOffset;

    const rtt = t1 - t0;
    const midpoint = t0 + rtt / 2;
    const serverTime = res.body.serverNow;
    const ntpOffset = serverTime - midpoint;

    // Client computes remaining time: deadline - (clientLocalNow + ntpOffset)
    const clientLocalNow = Date.now() + client.localClockOffset;
    const authoritativeClientNow = clientLocalNow + ntpOffset;
    const remainingMs = serverDeadline - authoritativeClientNow;

    computedRemainingTimes.push({
      client: client.name,
      offset: client.localClockOffset,
      remainingMs
    });

    console.log(`Client [${client.name}]: Computed Remaining = ${(remainingMs / 1000).toFixed(3)} s`);
  }

  const times = computedRemainingTimes.map(c => c.remainingMs);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const maxSkewMs = maxTime - minTime;

  console.log(`Maximum Skew across all clients: ${maxSkewMs.toFixed(2)} ms (Target: < 1000 ms)`);

  const passed = maxSkewMs < 1000;
  console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);

  return {
    test: 'timer_skew',
    target: 'Timer difference under 1 s across shifted device clocks (±1h)',
    measured: `Max skew = ${maxSkewMs.toFixed(1)} ms across all clients`,
    maxSkewMs,
    passed
  };
}

module.exports = { runTimerSkewTest };
if (require.main === module) {
  const harness = new ClusterHarness();
  runTimerSkewTest(harness);
}
