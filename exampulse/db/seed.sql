-- ExamPulse Seed Data (PostgreSQL 16)
-- Seed standard exam, questions, invigilators, and candidates

-- 1. Insert Staff (invigilators & admins)
-- Passwords hashed with bcrypt (cost 10) for 'password123' -> $2b$10$wJkE4lqC.3jOaH6Tcm7Lve1kYnF5KqXk3jYJomz6Y2T0QeY1.XNfa
INSERT INTO candidates (id, candidate_number, name, email, password_hash, role)
VALUES 
    (1, 'INVIG_001', 'Dr. Sarah Connor', 'invigilator@exampulse.io', '$2b$10$wJkE4lqC.3jOaH6Tcm7Lve1kYnF5KqXk3jYJomz6Y2T0QeY1.XNfa', 'invigilator'),
    (2, 'ADMIN_001', 'Prof. Charles Xavier', 'admin@exampulse.io', '$2b$10$wJkE4lqC.3jOaH6Tcm7Lve1kYnF5KqXk3jYJomz6Y2T0QeY1.XNfa', 'admin')
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Standard Exam
-- ID: 1, 60 minutes duration, starts now - 10 mins, ends now + 2 hours, grace_ms = 0
INSERT INTO exams (id, title, description, duration_minutes, start_at, end_at, grace_ms, is_active)
VALUES (
    1,
    'CS401: Distributed Systems & High-Throughput Architectures Final',
    'Official proctored examination covering distributed consensus, Redis persistence, idempotency, and server-authoritative timers.',
    60,
    NOW() - INTERVAL '10 minutes',
    NOW() + INTERVAL '3 hours',
    0,
    TRUE
) ON CONFLICT (id) DO UPDATE SET is_active = TRUE;

-- 3. Insert 10 Exam Questions (8 MCQs, 2 Short Text)
INSERT INTO questions (id, exam_id, question_number, question_type, prompt, options, correct_answer, points)
VALUES 
    (1, 1, 1, 'mcq', 'Under the CAP theorem, which property does a Redis master with asynchronous replication sacrifice during network partition?', 
     '["Consistency", "Availability", "Partition Tolerance", "Linearizability"]'::JSONB, 'Consistency', 1.00),
    
    (2, 1, 2, 'mcq', 'Why must multi-key Lua scripts in Redis specify all keys via KEYS table rather than ARGV or string literals?', 
     '["Redis Cluster routing and cluster key hashing tags", "Lua JIT compiler optimization", "Garbage collection efficiency", "Preventing SQL injection"]'::JSONB, 'Redis Cluster routing and cluster key hashing tags', 1.00),
    
    (3, 1, 3, 'mcq', 'What is the purpose of using the Redis WAIT command after a write in a master-replica topology?', 
     '["Blocks until specified replicas acknowledge write in replication stream", "Locks the master until all clients disconnect", "Forces OS disk sync on the master only", "Causes an immediate RDB snapshot"]'::JSONB, 'Blocks until specified replicas acknowledge write in replication stream', 1.00),
    
    (4, 1, 4, 'mcq', 'How does an idempotent API handle repeated requests with the identical Idempotency-Key?', 
     '["Returns the exact stored result of the original execution without re-executing", "Deletes the original resource and recreates it", "Throws HTTP 500 Internal Server Error", "Increments a version counter and appends duplicate data"]'::JSONB, 'Returns the exact stored result of the original execution without re-executing', 1.00),
    
    (5, 1, 5, 'mcq', 'In NTP time synchronization, why is the sample with the lowest Round Trip Time (RTT) preferred?', 
     '["Shorter RTT bounds the maximum possible asymmetry error between client and server", "Shorter RTT means the server is running faster", "It avoids DNS lookup delays", "It prevents TCP window scaling"]'::JSONB, 'Shorter RTT bounds the maximum possible asymmetry error between client and server', 1.00),
    
    (6, 1, 6, 'mcq', 'What Redis Stream consumer group command safely reclaims pending messages abandoned by crashed workers?', 
     '["XAUTOCLAIM", "XGROUP RESCUE", "XPOP", "XRANGE CLAIM"]'::JSONB, 'XAUTOCLAIM', 1.00),
    
    (7, 1, 7, 'mcq', 'Which PostgreSQL construct ensures atomic upserts with version gating to eliminate lost updates?', 
     '["INSERT ... ON CONFLICT (k) DO UPDATE ... WHERE excluded.v > target.v", "SELECT FOR UPDATE followed by manual UPDATE", "REPEATABLE READ transaction isolation only", "LOCK TABLE in EXCLUSIVE mode"]'::JSONB, 'INSERT ... ON CONFLICT (k) DO UPDATE ... WHERE excluded.v > target.v', 1.00),
    
    (8, 1, 8, 'mcq', 'What deterministic score formula encodes both points and speed into a single Redis sorted set score?', 
     '["score * 1e9 + (1e9 - secondsTaken)", "score / secondsTaken", "score + secondsTaken", "secondsTaken * 1e6 + score"]'::JSONB, 'score * 1e9 + (1e9 - secondsTaken)', 1.00),
    
    (9, 1, 9, 'short_text', 'Explain how a server-authoritative timer prevents local clock tampering by candidates.', 
     NULL, 'Server calculates remaining time using its own epoch clock. Client computes offset via round-trip midpoint. Every answer save and submit validates deadline on the server using Redis TIME in Lua.', 2.00),
    
    (10, 1, 10, 'short_text', 'Describe how Redis Lua scripts guarantee atomicity during single active session replacement.', 
     NULL, 'Redis executes Lua scripts atomically in a single thread. The script reads the old session ID, updates with the new session ID and timestamp, and returns the old session ID in one uninterruptible step.', 2.00)
ON CONFLICT (id) DO NOTHING;

-- 4. Fast bulk candidate seeding for 20,000 candidates
-- candidate_number: CAND_00001 to CAND_20000
-- Email: candidate1@exampulse.io to candidate20000@exampulse.io
-- Password hash: pre-hashed 'password123' so all candidates can authenticate
INSERT INTO candidates (id, candidate_number, name, email, password_hash, role)
SELECT 
    i + 10 AS id,
    'CAND_' || LPAD(i::TEXT, 5, '0') AS candidate_number,
    'Student ' || i AS name,
    'candidate' || i || '@exampulse.io' AS email,
    '$2b$10$wJkE4lqC.3jOaH6Tcm7Lve1kYnF5KqXk3jYJomz6Y2T0QeY1.XNfa' AS password_hash,
    'candidate' AS role
FROM generate_series(1, 20000) AS i
ON CONFLICT (candidate_number) DO NOTHING;

-- Reset sequence for candidates
SELECT setval('candidates_id_seq', (SELECT MAX(id) FROM candidates));
SELECT setval('exams_id_seq', (SELECT MAX(id) FROM exams));
SELECT setval('questions_id_seq', (SELECT MAX(id) FROM questions));
