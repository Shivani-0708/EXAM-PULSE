-- final_submit.lua
-- Atomically processes final exam submission with strict idempotency and deadline enforcement.
-- Guarantees:
-- 1. Idempotency-Key guarantee: Replayed requests return the exact stored outcome
-- 2. Once-only submission: Repeated submissions return the original result
-- 3. Server-authoritative deadline check via Redis TIME
-- 4. Late submissions are deterministically stored and marked REJECTED_LATE
-- 5. Answers snapshot hash generation
-- 6. Stream event enqueueing for asynchronous finalisation & grading
--
-- KEYS[1] = attempt:{examId}:{candidateId}
-- KEYS[2] = submission:{examId}:{candidateId}
-- KEYS[3] = answers:{examId}:{candidateId}
-- KEYS[4] = status:{examId}:{candidateId}
-- KEYS[5] = idem:{idempotencyKey}
-- ARGV[1] = examId
-- ARGV[2] = candidateId
-- ARGV[3] = idempotencyKey
-- ARGV[4] = graceMs (default 0)

local attemptKey = KEYS[1]
local submissionKey = KEYS[2]
local answersKey = KEYS[3]
local statusKey = KEYS[4]
local idemKey = KEYS[5]

local examId = ARGV[1]
local candidateId = ARGV[2]
local idempotencyKey = ARGV[3]
local graceMs = tonumber(ARGV[4]) or 0

-- 1. Server time authoritative check
local rTime = redis.call('TIME')
local serverNow = (tonumber(rTime[1]) * 1000) + math.floor(tonumber(rTime[2]) / 1000)

-- 2. Check if Idempotency Key was already processed
local existingIdem = redis.call('GET', idemKey)
if existingIdem then
    return { "IDEMPOTENT_REPEAT", existingIdem }
end

-- 3. Check if attempt already has a submission record
local existingSubResult = redis.call('HGET', submissionKey, 'resultJson')
if existingSubResult then
    -- Attempt already finalized with a prior submission; return prior outcome
    return { "ALREADY_SUBMITTED", existingSubResult }
end

-- 4. Check attempt validity
local attempt = redis.call('HMGET', attemptKey, 'deadline', 'status', 'startedAt')
if not attempt[1] then
    local errJson = cjson.encode({ error = "NO_ATTEMPT", message = "No active attempt found" })
    return { "ERROR_NO_ATTEMPT", errJson }
end

local deadline = tonumber(attempt[1])
local startedAt = tonumber(attempt[3]) or serverNow
local secondsTaken = math.max(0, math.floor((serverNow - startedAt) / 1000))

-- 5. Validate deadline
local status = "SUBMITTED"
if serverNow > (deadline + graceMs) then
    status = "REJECTED_LATE"
end

-- 6. Collect answers snapshot and compute sha1 hash
local answers = redis.call('HGETALL', answersKey)
local answersJson = cjson.encode(answers)
local snapshotHash = redis.sha1hex(answersJson)
local answeredCount = math.floor(#answers / 2)

local result = {
    status = status,
    examId = examId,
    candidateId = candidateId,
    idempotencyKey = idempotencyKey,
    submittedAt = serverNow,
    secondsTaken = secondsTaken,
    snapshotHash = snapshotHash,
    answeredCount = answeredCount
}
local resultJson = cjson.encode(result)

-- 7. Persist submission atomically
redis.call('HMSET', submissionKey,
    'status', status,
    'idemKey', idempotencyKey,
    'submittedAt', serverNow,
    'secondsTaken', secondsTaken,
    'snapshotHash', snapshotHash,
    'resultJson', resultJson
)

-- Store idempotency key mapping with 24-hour expiration
redis.call('SETEX', idemKey, 86400, resultJson)

-- Update attempt status
redis.call('HSET', attemptKey, 'status', status)

-- Update candidate status
redis.call('HMSET', statusKey,
    'state', status,
    'lastSeen', serverNow,
    'answeredCount', answeredCount
)

-- 8. Enqueue to stream:submissions for background worker processing
redis.call('XADD', 'stream:submissions', '*',
    'examId', examId,
    'candidateId', candidateId,
    'idempotencyKey', idempotencyKey,
    'status', status,
    'submittedAt', tostring(serverNow),
    'secondsTaken', tostring(secondsTaken),
    'snapshotHash', snapshotHash
)

-- 9. Notify invigilator dashboard
redis.call('PUBLISH', 'channel:dashboard:' .. examId, cjson.encode({
    type = 'CANDIDATE_SUBMITTED',
    candidateId = candidateId,
    status = status,
    timestamp = serverNow
}))

return { status, resultJson }
