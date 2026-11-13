# ExamPulse: Frequently Asked Judge Questions & Answers

### Q1: Why use Redis as a write buffer instead of writing directly to PostgreSQL?
**A:** Under an exam load of 20,000 students saving answers every 2 seconds, direct write-through would subject PostgreSQL to 10,000 write queries per second. PostgreSQL transactions incur write-ahead logging (WAL), table lock coordination, and MVCC tuple creation, causing connection pool exhaustion and tail-latency spikes (>2,000ms). Redis handles in-memory writes at over 80,000 ops/sec with sub-millisecond latencies. Combining Redis AOF + replica `WAIT` gives us immediate durability and low latency, while background stream workers batch-persist to PostgreSQL without threatening exam delivery.

### Q2: How are your application instances stateless if they track active sessions and timers?
**A:** Neither `app1` nor `app2` holds session state, answer state, or timer state in process memory. Every request authenticates by validating the bearer token and doing a fast Redis `HGET` on `session:{candidateId}.sid`. Timers are calculated using Redis `TIME` and stored in Redis hashes. Any client request can land on `app1` or `app2` interchangeably; if one instance is terminated, Nginx immediately routes the next request to the other node with zero data loss or session interruption.

### Q3: How do you prevent a cache stampede when 20,000 students start at the exact same second?
**A:** Three defenses work in harmony:
1. **Pre-Exam Warmup:** Metadata and question banks are preloaded into Redis and per-app in-memory caches before the exam window opens.
2. **Single-Flight Distributed Locking:** On any cache miss, instances attempt `SET lock:exam:id NX PX 3000`. Only one process loads from PostgreSQL while concurrent callers wait or serve from a stale copy.
3. **Deterministic Question Ordering:** Instead of querying the database to generate randomized papers, the backend runs a deterministic seeded shuffle: `shuffle(questionIds, seed = hash(examId + candidateId))`. This generates distinct, reproducible papers in pure CPU memory with zero database queries.

### Q4: How is final submission guaranteed to be strictly idempotent?
**A:** The client generates a unique `Idempotency-Key` (UUID) upon opening the exam and reuses that key across retries and double-clicks. Inside `final_submit.lua`, Redis checks if `idem:{key}` or `submission:{attemptId}` exists. If found, it returns the exact stored outcome immediately. In PostgreSQL, unique constraints on `attempt_id` and `idempotency_key` prevent duplicate records at the database engine level.

### Q5: How is the timer protected against candidate device clock tampering?
**A:** The server alone decides time. Changing the operating system clock or time zone on the candidate's laptop has zero effect:
1. The client synchronizes offset against the server via NTP-style round-trip midpoint calculation: $\text{offset} = \text{serverNow} - (t_{\text{req}} + RTT/2)$.
2. The deadline is stored as an absolute epoch timestamp in Redis.
3. Every answer write and final submission validates `serverNow <= deadline` inside the Redis Lua script using Redis system `TIME`.

### Q6: What is your exact definition of "SAVED"?
**A:** An answer is defined as **SAVED** only when:
1. The atomic `autosave.lua` script commits the write to the Redis master hash and stream.
2. The master's Append-Only File (AOF) records the command.
3. Redis `WAIT 1 <timeoutMs>` returns $\ge 1$, confirming that at least one replica acknowledged receiving the write in its replication stream.
Only then does the API return `{saved: true}`. If `WAIT` times out, the API returns HTTP 503, and the candidate frontend truthfully displays *"Offline: N changes pending locally (Not Saved to Server)"*.

### Q7: Why did you optimize your AI collusion model for precision ($F_{0.5}$) rather than recall?
**A:** In high-stakes academic examinations, a false positive (falsely accusing an honest student of cheating) carries catastrophic reputational and psychological consequences. Conversely, a false negative can be caught by secondary human invigilator room monitoring. Therefore, we optimized the decision threshold on validation groups using an $F_{0.5}$ metric that weights precision twice as heavily as recall, achieving 86.7% precision and 85.7% $F_1$.

### Q8: Why did you use synthetic data rather than historical student exams?
**A:** Real institutional examination logs are legally protected student educational records under FERPA and GDPR. Furthermore, historical exam sets lack ground-truth collusion labels (known cheaters vs. honest students). Our synthetic data generator creates mathematically realistic student cohorts with controlled collusion clusters (rare wrong answer matching, synchronized sub-second timing, overlapping tab-hidden intervals) and hard negatives (honest high-achievers who share correct answers).

### Q9: Why are there no automatic grading penalties for AI collusion flags?
**A:** Core Architectural Principle: **AI must never penalize automatically; it only produces explainable flags for human review.** Algorithmic assessment can be subject to bias, edge-case network artifacts, or accidental phrasing commonalities. Every flag surfaces explainable feature contributions (e.g. `RARE_MCQ_MATCH`, `SYNCHRONIZED_TIMING`) and provides invigilators with "Reviewed (Safe)", "Dismiss", or "Escalate" audit-logged workflows.

### Q10: What happens if a background worker crashes while processing a batch of answers from the stream?
**A:** Redis Streams consumer groups maintain a Pending Entries List (PEL). If a worker crashes before executing `XACK`, the message remains in the PEL. Surviving or restarted workers call `XAUTOCLAIM stream:answers persisters <workerId> 10000 0-0` to safely reclaim any messages idle for more than 10 seconds. PostgreSQL's version-gated upsert (`WHERE excluded.version > answers.version`) ensures that replaying an unacknowledged message is completely idempotent.
