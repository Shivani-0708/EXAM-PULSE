-- ExamPulse Database Schema (PostgreSQL 16)
-- High performance schema for online examination, autosave persistence, and collusion detection

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Candidates table
CREATE TABLE IF NOT EXISTS candidates (
    id SERIAL PRIMARY KEY,
    candidate_number VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'candidate', -- 'candidate', 'invigilator', 'admin'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_number ON candidates(candidate_number);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);

-- 2. Exams table
CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INT NOT NULL DEFAULT 60,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    grace_ms INT NOT NULL DEFAULT 0, -- Grace period policy (default 0 ms)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Questions table
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_number INT NOT NULL,
    question_type VARCHAR(32) NOT NULL DEFAULT 'mcq', -- 'mcq', 'short_text'
    prompt TEXT NOT NULL,
    options JSONB, -- Array of strings/objects for MCQ, NULL for short text
    correct_answer TEXT, -- Exact text or option index for auto-grading
    points NUMERIC(5,2) NOT NULL DEFAULT 1.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_exam_question_number UNIQUE (exam_id, question_number)
);

CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);

-- 4. Attempts table (one attempt per candidate per exam)
CREATE TABLE IF NOT EXISTS attempts (
    id SERIAL PRIMARY KEY,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    candidate_id INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    question_order JSONB NOT NULL, -- Deterministic seeded shuffle order
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline TIMESTAMPTZ NOT NULL, -- Absolute server-authoritative deadline
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUBMITTED', 'REJECTED_LATE', 'EXPIRED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_candidate_exam UNIQUE (candidate_id, exam_id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_candidate_exam ON attempts(candidate_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam_status ON attempts(exam_id, status);

-- 5. Answers table (durable source of record populated by worker from Redis Streams)
CREATE TABLE IF NOT EXISTS answers (
    id SERIAL PRIMARY KEY,
    attempt_id INT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    question_id INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    answer TEXT,
    version INT NOT NULL DEFAULT 1,
    client_ts BIGINT,
    server_ts BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attempt_question UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_attempt_id ON answers(attempt_id);

-- 6. Submissions table (idempotent final submission guarantee)
CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    attempt_id INT UNIQUE NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    status VARCHAR(32) NOT NULL, -- 'SUBMITTED', 'REJECTED_LATE'
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answer_snapshot_hash VARCHAR(64) NOT NULL,
    server_ts BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_attempt ON submissions(attempt_id);
CREATE INDEX IF NOT EXISTS idx_submissions_idem ON submissions(idempotency_key);

-- 7. Results table (final calculated score, ranking, time taken)
CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    attempt_id INT UNIQUE NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    candidate_id INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    score NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    max_score NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    seconds_taken INT NOT NULL DEFAULT 0,
    rank INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_exam_score ON results(exam_id, score DESC, seconds_taken ASC);

-- 8. Events table (telemetry, visibility, tab switches, blur/focus)
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    candidate_id INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL, -- 'TAB_HIDDEN', 'TAB_VISIBLE', 'FOCUS_LOST', 'FOCUS_GAINED', 'HEARTBEAT'
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_candidate_exam ON events(candidate_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

-- 9. Flags table (AI collusion & rule fallback detections for invigilator review)
CREATE TABLE IF NOT EXISTS flags (
    id SERIAL PRIMARY KEY,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    candidate_id INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    linked_candidates JSONB NOT NULL DEFAULT '[]'::JSONB,
    risk_score NUMERIC(4,3) NOT NULL DEFAULT 0.000,
    reasons JSONB NOT NULL DEFAULT '[]'::JSONB, -- Array of {code, description, contribution}
    evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'REVIEWED', 'DISMISSED', 'ESCALATED'
    reviewed_by INT REFERENCES candidates(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flags_exam_candidate ON flags(exam_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);

-- 10. Audit Log table (immutable history of system & security events)
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL, -- 'LOGIN', 'SESSION_REPLACED', 'EXAM_STARTED', 'ANSWER_BATCH_PERSISTED', 'SUBMISSION', 'FLAG_REVIEW'
    actor_id INT,
    actor_role VARCHAR(32),
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);
