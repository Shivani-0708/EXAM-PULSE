# ExamPulse System Architecture & Distributed Data Flows

ExamPulse is a server-authoritative, high-throughput distributed assessment platform engineered to start 20,000 simulated candidates within one minute, eliminate cache stampedes, guarantee zero lost acknowledged answers via Redis AOF and replica \`WAIT\`, enforce single active sessions and server-authoritative timers, and provide explainable AI collusion detection with rule-based fallback.

---

## 1. System Topology Overview

```mermaid
flowchart TD
    Client["Candidate Browsers / Load Simulator (20,000 Concurrent)"]
    Nginx["Nginx Reverse Proxy & Load Balancer (:80, max_fails=1, fail_timeout=2s)"]
    App1["Fastify App 1 (:3000, Stateless)"]
    App2["Fastify App 2 (:3000, Stateless)"]
    RedisM["Redis 7 Master (AOF everysec, Port 6379)"]
    RedisR["Redis 7 Replica (WAIT 1 ack, Port 6380)"]
    Worker["Node.js Stream Worker Pool (Persister & Finaliser)"]
    PG[("PostgreSQL 16 Durable Source of Record (:5432)")]
    AIService["FastAPI AI Service (:8000, TF-IDF + Logistic Regression)"]

    Client -->|HTTP / WebSocket| Nginx
    Nginx -->|Round Robin + proxy_next_upstream| App1
    Nginx -->|Round Robin + proxy_next_upstream| App2
    App1 -->|Lua Scripts, TIME, Streams, Pub/Sub| RedisM
    App2 -->|Lua Scripts, TIME, Streams, Pub/Sub| RedisM
    RedisM -->|Replication Stream| RedisR
    Worker -->|XREADGROUP & XAUTOCLAIM| RedisM
    Worker -->|Batch Version-Gated Upserts| PG
    App1 -->|Circuit Breaker Timeout 1s| AIService
    App2 -->|Circuit Breaker Timeout 1s| AIService
```

---

## 2. (a) The Start Path (Absorbing the Spike Without Cache Stampede)

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate Client
    participant LB as Nginx Load Balancer
    participant App as Stateless Backend (App1 / App2)
    participant Redis as Redis Master (In-Memory + AOF)
    participant PG as PostgreSQL 16

    Note over Redis,PG: Pre-Exam Warmup loaded questions & meta into Redis and App memory
    C->>LB: POST /api/exam/:id/start
    LB->>App: Forward request (Round-Robin)
    App->>Redis: EVAL rate_limit.lua (Token Bucket)
    alt Rate Limit Exceeded
        Redis-->>App: {allowed: 0, retryAfterMs: 1200}
        App-->>C: HTTP 429 Too Many Requests (Retry-After: 2)
    else Token Acquired
        App->>App: Compute deterministic shuffle: hash(examId + candidateId)
        App->>Redis: EVAL exam_start.lua (attempt:{id}:{cid}, Redis TIME)
        Redis->>Redis: Atomically calculate deadline = serverNow + duration
        Redis->>Redis: XADD stream:attempts
        Redis-->>App: {isNew, startedAt, deadline, questionOrder}
        App-->>C: HTTP 200 OK (attempt details & server deadline)
    end
    Note over C,PG: Zero PostgreSQL hits on the critical start path
```

---

## 3. (b) The Answer Save Path (Acknowledged Durability Guarantee)

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate Frontend
    participant App as Stateless Fastify Instance
    participant RM as Redis 7 Master (AOF everysec)
    participant RR as Redis 7 Replica
    participant W as Stream Worker (Consumer Group)
    participant PG as PostgreSQL 16

    C->>C: Debounce keystrokes (800ms)
    C->>App: PUT /api/exam/:id/answers/:qid {answer, version, clientTs}
    App->>RM: EVAL autosave.lua
    RM->>RM: Check Redis TIME <= deadline
    alt Deadline Expired
        RM-->>App: ERROR_EXPIRED
        App-->>C: HTTP 403 Forbidden (DEADLINE_EXPIRED)
    else Valid Monotonic Version
        RM->>RM: HSET answers:{examId}:{cid} qid -> {answer, version, serverTs}
        RM->>RM: XADD stream:answers
        RM-->>App: OK (version, serverTs)
        App->>RM: WAIT 1 50 (Wait for 1 replica ack)
        RM->>RR: Synchronize replication offset
        RR-->>RM: Acknowledged
        RM-->>App: Replicas Acked = 1
        App-->>C: HTTP 200 {saved: true, version, serverTs}
        Note over C: UI transitions from "Saving..." to "Saved at HH:MM:SS"
    end

    Note over W,PG: Asynchronous Background Persistence
    W->>RM: XREADGROUP GROUP persisters worker-1 BLOCK 2000
    RM-->>W: Batch [answers]
    W->>PG: INSERT INTO answers ... ON CONFLICT DO UPDATE WHERE excluded.version > answers.version
    PG-->>W: Batch Committed
    W->>RM: XACK stream:answers persisters [ids]
```

---

## 4. (c) The Final Submission Path (Strict Idempotency & Rush Handling)

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate Client
    participant App as Stateless Fastify Backend
    participant Redis as Redis Master
    participant W as Worker Finaliser
    participant PG as PostgreSQL 16

    C->>App: POST /api/exam/:id/submit [Header: Idempotency-Key]
    App->>Redis: EVAL final_submit.lua (idem:{key}, submission:{id}:{cid})
    alt Idempotency Key Already Processed
        Redis-->>App: Return stored result immediately (Identical response)
        App-->>C: HTTP 200 OK (Original Receipt)
    else First Submission Execution
        Redis->>Redis: Check serverNow <= deadline (or flag REJECTED_LATE)
        Redis->>Redis: Compute sha1 of all answers in answers:{id}:{cid}
        Redis->>Redis: Store submission hash & SETEX idem:{key}
        Redis->>Redis: XADD stream:submissions
        Redis-->>App: {status, resultJson}
        App-->>C: HTTP 200 OK {success: true, submission: result}
    end

    Note over W,PG: Asynchronous Scoring and Leaderboard Pipeline
    W->>Redis: XREADGROUP GROUP finalisers
    Redis-->>W: Batch [submission_events]
    W->>PG: INSERT INTO submissions (attempt_id, idem_key, snapshot_hash)
    W->>PG: Calculate score from questions & candidate answers
    W->>PG: INSERT INTO results (attempt_id, score, seconds_taken)
    W->>Redis: ZADD leaderboard:{examId} (score * 1e9 + (1e9 - secondsTaken))
    W->>Redis: XACK stream:submissions
```

---

## 5. (d) Instance Failover Path (Zero-Downtime Resilience)

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate
    participant Nginx as Nginx Load Balancer
    participant App1 as App 1 (Failed Node)
    participant App2 as App 2 (Surviving Node)
    participant Redis as Shared Redis Master

    C->>Nginx: HTTP Request (PUT /answers/1)
    Nginx->>App1: Forward request
    Note over App1: App1 crashes / killed by operator
    App1--xNginx: TCP RST / Connection Refused / 502
    Note over Nginx: proxy_next_upstream error timeout (failover < 5s)
    Nginx->>App2: Retry request immediately
    App2->>Redis: Validate session:{cid} & save answer
    Redis-->>App2: {saved: true}
    App2-->>Nginx: HTTP 200 OK
    Nginx-->>C: HTTP 200 OK (Zero user impact, remaining time intact)
```

---

## 6. (e) Realtime Fan-Out & Explainable AI Collusion Pipeline

```mermaid
flowchart TD
    Candidates["Candidates Telemetry (Page Visibility, Tab Blur, Answers)"]
    Instances["Stateless App Instances (App1 & App2)"]
    RedisPub["Redis Pub/Sub (channel:dashboard:1)"]
    Aggregator["500ms Batched Delta Aggregator"]
    Dashboards["Invigilator WebSockets & Dashboard UI"]
    AiClient["AI Client (Circuit Breaker 1s Timeout)"]
    FastAPI["Python FastAPI AI Service (:8000)"]
    RuleFallback["Rule-Based Fallback Engine"]
    FlagStore[("PostgreSQL Flags & Audit Table")]

    Candidates -->|POST /api/events & heartbeats| Instances
    Instances -->|Publish events| RedisPub
    RedisPub -->|Subscribe| Aggregator
    Aggregator -->|Batch delta frames every 500ms| Dashboards

    Instances -->|Async Collusion Query| AiClient
    AiClient -->|Circuit State: CLOSED| FastAPI
    FastAPI -->|TF-IDF + LR Coefficients| AiClient
    AiClient -.->|Timeout / Connection Failure (Circuit OPEN)| RuleFallback
    AiClient -->|Advisory Collusion Flags with Contributions| FlagStore
    FlagStore -->|Review Action: Safe / Dismiss / Escalate| Dashboards
```
