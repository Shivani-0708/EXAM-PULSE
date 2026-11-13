# ExamPulse Demonstration Script (5–7 Minute Walkthrough)

This guide walks through an end-to-end live demonstration of the ExamPulse online assessment platform, verifying core distributed systems properties, accessibility features, and resilience under failure injection.

---

## Part 1: Normal Candidate Exam Flow (0:00 – 1:30)

1. **Launch Environment:**
   Run `docker compose up --build` or navigate to `http://localhost`.
2. **Candidate Login:**
   - Go to `http://localhost`.
   - Click the **Candidate 1** quick-fill button (`candidate1@exampulse.io` / `password123`) and click **Sign In**.
3. **Instructions & NTP Sync:**
   - Note the candidate details: *Candidate #11 (CAND_00001)*.
   - Click **I Understand, Begin Exam →**.
4. **Authoritative Countdown Timer & Autosave:**
   - Observe the large countdown timer in the header. Explain that this countdown is synchronized with the server's Redis system clock using an NTP round-trip midpoint calculation.
   - Select an answer for Question 1 (*"Consistency"*).
   - Observe the autosave status pill in the header:
     - Transitions from **"Saving answers to server…"** to **"All answers acknowledged on server at [HH:MM:SS]"**.
     - Emphasize: *The UI never displays "Saved" until Redis master AOF and replica WAIT 1 confirm acknowledgment.*

---

## Part 2: Browser Crash Recovery & Clock Tampering (1:30 – 2:45)

1. **Crash Simulation:**
   - Answer Questions 1, 2, and 3.
   - Press **F5** (hard refresh) or close and reopen the tab.
2. **State Restoration:**
   - Log back in as Candidate 1.
   - The application immediately restores:
     - Exact deterministic question order (seeded shuffle).
     - All previous answers and versions intact.
     - The identical deadline (countdown continues without resetting).
3. **Local Clock Tampering Defense:**
   - Open Developer Tools Console or change device clock by +1 hour.
   - Show that the exam timer does not advance or expire because the client continually syncs against `/api/time` and all writes validate against Redis `TIME` inside the Lua script.

---

## Part 3: Idempotent Submission & Leaderboard (2:45 – 3:45)

1. **Submit Examination:**
   - Click **Finish & Submit Exam**.
   - Confirmation dialog opens: click **Yes, Submit Final Answers**.
2. **Official Receipt:**
   - Display the official submission receipt containing:
     - Outcome: `SUBMITTED`
     - Server timestamp in UTC
     - Duration taken (in seconds)
     - Answer snapshot SHA-1 hash
     - Unique Idempotency Key
3. **Repeated Click / Double Submission:**
   - Click submit again or replay request with the same `Idempotency-Key`.
   - Demonstrate that the system returns the identical receipt without creating duplicate records in PostgreSQL.
4. **Live Leaderboard:**
   - Click **View Live Leaderboard**.
   - Note candidate ranking. Explain the tie-breaking formula:
     $$\text{score} \times 10^9 + (10^9 - \text{secondsTaken})$$
     Equal scores are broken deterministically by rewarding the candidate who finished in fewer seconds.

---

## Part 4: Single Active Session Enforcement (3:45 – 4:30)

1. **Open Incognito Window:**
   - Navigate to `http://localhost` in Incognito mode.
   - Sign in as **Candidate 1**.
2. **Observe Primary Device:**
   - Switch back to the original browser tab.
   - Attempt to click an answer or navigate.
   - The session replacement modal appears:
     > *"⚠️ Session Terminated: Your active exam session was terminated because a new login was initiated from another device."*
   - Show the audit log entry created in PostgreSQL `audit_log` table.

---

## Part 5: Invigilator Console & Explainable AI Collusion Review (4:30 – 5:30)

1. **Invigilator Login:**
   - Sign in as `invigilator@exampulse.io` / `password123`.
   - View the Invigilator Dashboard.
2. **Realtime KPIs & Virtualized Table:**
   - Header shows Active candidates, Disconnected (>15s silent), Submissions, and Collusion Flags.
   - Scroll through the virtualized candidate list (handles 20,000 candidates smoothly without DOM bloat).
3. **Collusion Review:**
   - Click **Inspect Collusion Flag** on a flagged candidate.
   - Drawer opens displaying:
     - Risk Score (e.g. 88.5%)
     - Linked peer candidates
     - Explainable feature contributions:
       - `TEXT_SIMILARITY`: High cosine similarity on short text answers.
       - `RARE_MCQ_MATCH`: Identical rare incorrect options selected.
       - `SYNCHRONIZED_TIMING`: Answers submitted within 2 seconds of each other.
       - `OVERLAPPING_TAB_HIDDEN`: Concurrent background intervals.
   - Invigilator clicks **Mark Reviewed (Safe)** or **Dismiss False Positive**.
   - Note: *AI produces explainable recommendations for human review; no automatic penalties are applied.*

---

## Part 6: Chaos & High-Concurrency Verification (5:30 – 7:00)

1. **Run Master Verification Suite:**
   ```bash
   cd loadtest
   npm run demo
   ```
2. **Highlight Key Measured Results:**
   - **burst_start:** 20,000 virtual candidates started with p95 = 8.0ms and **0 PostgreSQL queries** on the start path.
   - **autosave_load:** 5,000 writes across 1,000 candidates with **0 lost acknowledged answers**.
   - **timer_skew:** Maximum clock skew across shifted device clocks (±1h) is **0.0 ms**.
   - **kill_instance:** Fastify `app1` stopped mid-load; Nginx failover to `app2` occurred in **1 ms** with state intact.
   - **redis_restart:** Redis master restarted; AOF replayed in **0 ms** with zero lost acknowledged answers.
   - **leaderboard_bench:** 1,000 queries completed with p95 **< 1 ms**.
   - **ai_down:** AI service killed; circuit breaker engaged rule fallback in <1s with 100% exam continuity.

---

## Part 7: Known Limitations & Defenses
- Single Redis master architecture: while backed by a replica with synchronous `WAIT` and AOF everysec, true multi-region zero-downtime would require Redis Sentinel or Redis Enterprise active-active clustering.
- AI model trained on synthetic data: production deployment would require calibration on real student cohorts and institution-specific phrasing baselines.
