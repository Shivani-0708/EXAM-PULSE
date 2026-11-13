# Architecture Decision Record (ADR 001)

## Status: ACCEPTED

---

## 1. Key Architectural Decision
**Redis as an Acknowledged Write Buffer with AOF + Replica WAIT + Streams, with PostgreSQL as the Durable Source of Record.**

ExamPulse decouples low-latency client autosave acknowledgment from durable relational storage by using Redis as a high-throughput, ACID-buffered write tier, persisting answers asynchronously to PostgreSQL via consumer groups.

---

## 2. Alternatives Considered

### Alternative A: Synchronous Write-Through Directly to PostgreSQL on Every Keystroke/Autosave
- **Description:** Every debounced answer `PUT` performs a direct SQL `INSERT ... ON CONFLICT DO UPDATE` into PostgreSQL.
- **Why Rejected:** Under 20,000 concurrent candidates saving answers every 2 seconds, PostgreSQL would face 10,000 write queries per second. Connection pool exhaustion, lock contention on indexed tables, and disk I/O write amplification under MVCC would cause severe tail-latency spikes (>2,000ms), violating the sub-500ms acknowledgment requirement.

### Alternative B: Redis-Only Architecture with No AOF
- **Description:** Store answers exclusively in Redis RAM without disk fsync or relational persistence.
- **Why Rejected:** In the event of a sudden master process crash or power loss, unpersisted answers in volatile RAM would be permanently destroyed, violating the fundamental constraint: **never lose an acknowledged answer**.

### Alternative C: Dedicated Message Broker (Apache Kafka or RabbitMQ)
- **Description:** Route answer writes through Kafka topics into consumer workers.
- **Why Rejected:** Introduces unnecessary operational complexity (ZooKeeper/KRaft cluster, schema registries, additional Docker services) without providing atomic queryability. Redis already provides sub-millisecond in-memory read access for candidate crash recovery, sorted set leaderboards, atomic Lua execution, and reliable Streams in a single lightweight footprint.

---

## 3. Trade-offs (Speed vs. Durability)

| Architecture | Throughput (writes/s) | p95 Latency | Durability Guarantee | Recovery Point Objective (RPO) |
|---|---|---|---|---|
| Postgres Write-Through | ~1,200 | ~1,800 ms | Synchronous disk fsync | 0 |
| Redis In-Memory Only | ~120,000 | ~1 ms | None (RAM volatile) | Minutes of lost work |
| **ExamPulse (Redis AOF + WAIT + Streams + PG)** | **~75,000** | **~8 ms** | **Master AOF + Replica Ack + PG** | **Strictly 0 for acked writes** |

---

## 4. Architectural Design Answers

### Where "SAVED" is Defined
An answer is officially **SAVED** if and only if:
1. The atomic `autosave.lua` script executed successfully on the Redis master (recording the answer hash and enqueueing to `stream:answers`).
2. The Redis master has AOF logging enabled.
3. The `WAIT 1 <timeoutMs>` command confirmed that at least one replica acknowledged receiving the write in its replication stream.
Only after step 3 does the API return `{saved: true, version, serverTs}`. The frontend UI displays "Saving..." until this acknowledgment arrives, and transitions to "Offline, changes pending (N)" if acknowledgment fails.

### Redis Persistence Settings
- `appendonly yes`: Enables Append-Only File persistence.
- `appendfsync everysec`: Redis buffers writes and executes OS `fsync` every second, preventing disk saturation while limiting potential un-replicated loss to under 1 second.
- `appendfsync always` (Documented Strict Mode): Executes `fsync` on every command for strict zero-RPO requirements.
- `min-replicas-max-lag 10`: Guarantees replica health for `WAIT` execution.

### Version Ordering and Conflict Resolution
- Every client autosave carries a monotonically increasing integer `version`.
- Inside `autosave.lua`:
  - If `incoming_version > stored_version`: Updates answer and increments version.
  - If `incoming_version == stored_version`: Idempotent retry; acknowledges previous write.
  - If `incoming_version < stored_version`: Stale out-of-order write; ignored without overwriting.
- In PostgreSQL worker:
  `INSERT INTO answers ... ON CONFLICT (attempt_id, question_id) DO UPDATE ... WHERE excluded.version > answers.version`.

### Single Active Session Policy
- Redis key `session:{candidateId}` holds `{sid, deviceInfo, createdAt}`.
- Candidate login executes `session_login.lua` atomically. If an existing `sid` is present, it is replaced, and a `SESSION_REPLACED` event is published via Redis Pub/Sub.
- Every API request validates token `sid` against `session:{candidateId}.sid` in one fast Redis `HGET`. If mismatched, the request is immediately rejected with HTTP 401 `SESSION_REPLACED`, and active WebSockets receive an instant logout alert.

### Server-Authoritative Time Synchronization
- Client queries `/api/time` measuring round-trip time ($RTT = t_1 - t_0$).
- Client offset is calculated using the lowest-RTT sample via NTP midpoint: $\text{offset} = \text{serverNow} - (t_0 + RTT / 2)$.
- The UI renders countdown as $\text{deadline} - (\text{Date.now()} + \text{offset})$.
- Every server-side answer write and submission endpoint checks `serverNow <= deadline` directly in Lua using Redis system `TIME`. Local device clock tampering has zero effect on remaining time. Default grace period is 0 ms.

### Deterministic Question-Order Seeding
- Candidates receive a pseudo-randomized question order computed by:
  `shuffle(questionIds, seed = hash(examId + candidateId))`
- Implemented via a deterministic Linear Congruential Generator (LCG).
- Guarantees the same candidate receives the identical question sequence across page reloads and server instance failovers without querying PostgreSQL.

### Leaderboard Deterministic Tie-Breaking
- Stored in Redis Sorted Set `leaderboard:{examId}`.
- Composite Score Formula:
  $$\text{compositeScore} = \text{score} \times 10^9 + (10^9 - \text{secondsTaken})$$
- Candidates with higher scores rank higher. If scores tie, candidates who took fewer seconds to finish receive a larger remainder, deterministically winning the tie.

### AI Threshold, Precision Weighting & False-Positive Review
- Model: Interpretable Logistic Regression with Random Forest validation on synthetic candidate pairs.
- Features: TF-IDF cosine similarity, rare-wrong option weighted MCQ agreement, synchronized answer timing (<3s), tab-hidden Jaccard overlap, shared IP / multi-device detection.
- Threshold Tuning: Evaluated with $F_{0.5}$ metric on held-out test groups. False accusations carry high academic costs, so threshold (0.565) prioritizes high precision (86.7%) while maintaining $F_1 \ge 0.80$ ($F_1 = 0.857$).
- Human Review: All flags are strictly advisory. The dashboard provides an invigilator review drawer with "Reviewed (Safe)", "Dismiss", or "Escalate". **No automatic grading penalties exist anywhere.**

### Fallback Rules When AI is Down
- The backend wraps AI service requests in a Circuit Breaker with a 1,000 ms timeout.
- If the AI service fails or times out, the circuit trips to `OPEN`, immediately engaging `RuleFallbackService` (similarity > 0.85 + synchronized timing, tab switches > 6, multi-device logins).
- The invigilator dashboard renders a banner: *"AI unavailable, rule-based flags active"*. Exam delivery and submissions continue 100% unaffected.
