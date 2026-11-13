-- exam_start.lua
-- Atomically starts or resumes an exam attempt.
-- Guarantees:
-- 1. Idempotency: Repeated starts return the exact existing attempt and deadline
-- 2. Server-authoritative time: Calculated strictly via Redis TIME
-- 3. Hard deadline cutoff capping
-- 4. Stream event enqueue for durable persistence
--
-- KEYS[1] = attempt:{examId}:{candidateId}
-- KEYS[2] = status:{examId}:{candidateId}
-- ARGV[1] = examId
-- ARGV[2] = candidateId
-- ARGV[3] = questionOrderJson
-- ARGV[4] = durationMinutes
-- ARGV[5] = hardEndMs (optional global cutoff epoch ms)

local attemptKey = KEYS[1]
local statusKey = KEYS[2]
local examId = ARGV[1]
local candidateId = ARGV[2]
local questionOrder = ARGV[3]
local durationMinutes = tonumber(ARGV[4]) or 60
local hardEndMs = tonumber(ARGV[5]) or 0

-- Check if attempt already exists
local existing = redis.call('HMGET', attemptKey, 'startedAt', 'deadline', 'questionOrder', 'status')
if existing[1] then
    -- Already exists: return existing state (idempotent response)
    return { 0, existing[1], existing[2], existing[3], existing[4] }
end

-- Use Redis system time as authoritative source
local rTime = redis.call('TIME')
local serverNow = (tonumber(rTime[1]) * 1000) + math.floor(tonumber(rTime[2]) / 1000)

-- Compute deadline
local deadline = serverNow + (durationMinutes * 60 * 1000)
if hardEndMs > 0 and deadline > hardEndMs then
    deadline = hardEndMs
end

-- Save attempt hash
redis.call('HMSET', attemptKey,
    'startedAt', serverNow,
    'deadline', deadline,
    'questionOrder', questionOrder,
    'status', 'ACTIVE'
)

-- Set initial candidate status for invigilator dashboard
redis.call('HMSET', statusKey,
    'candidateId', candidateId,
    'state', 'ACTIVE',
    'lastSeen', serverNow,
    'tabSwitches', 0,
    'answeredCount', 0
)

-- Add to heartbeats sorted set for offline/disconnected sweeper
redis.call('ZADD', 'heartbeats:' .. examId, serverNow, candidateId)

-- Enqueue attempt created event into Redis Stream
redis.call('XADD', 'stream:attempts', '*',
    'examId', examId,
    'candidateId', candidateId,
    'startedAt', serverNow,
    'deadline', deadline,
    'questionOrder', questionOrder
)

-- Notify dashboard of candidate start
redis.call('PUBLISH', 'channel:dashboard:' .. examId, cjson.encode({
    type = 'CANDIDATE_STARTED',
    candidateId = candidateId,
    timestamp = serverNow
}))

return { 1, tostring(serverNow), tostring(deadline), questionOrder, 'ACTIVE' }
