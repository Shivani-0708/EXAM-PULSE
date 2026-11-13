-- autosave.lua
-- Atomically validates and persists an answer write into Redis
-- Guarantees:
-- 1. Server-authoritative deadline validation via Redis TIME
-- 2. Monotonic version ordering (rejects stale/out-of-order versions)
-- 3. Idempotent acceptance of duplicate version requests
-- 4. Stream enqueueing for asynchronous PostgreSQL durability
-- 5. Heartbeat & candidate answer count update
--
-- KEYS[1] = attempt:{examId}:{candidateId}
-- KEYS[2] = answers:{examId}:{candidateId}
-- KEYS[3] = status:{examId}:{candidateId}
-- ARGV[1] = examId
-- ARGV[2] = candidateId
-- ARGV[3] = questionId
-- ARGV[4] = answer
-- ARGV[5] = version
-- ARGV[6] = clientTs
-- ARGV[7] = graceMs (default 0)

local attemptKey = KEYS[1]
local answersKey = KEYS[2]
local statusKey = KEYS[3]

local examId = ARGV[1]
local candidateId = ARGV[2]
local questionId = ARGV[3]
local answer = ARGV[4]
local version = tonumber(ARGV[5])
local clientTs = ARGV[6]
local graceMs = tonumber(ARGV[7]) or 0

-- 1. Server time authoritative check
local rTime = redis.call('TIME')
local serverNow = (tonumber(rTime[1]) * 1000) + math.floor(tonumber(rTime[2]) / 1000)

-- 2. Validate attempt existence, status, and deadline
local attempt = redis.call('HMGET', attemptKey, 'deadline', 'status')
if not attempt[1] then
    return { "ERROR_NO_ATTEMPT", 0, "0" }
end

local deadline = tonumber(attempt[1])
local status = attempt[2]

if status == 'SUBMITTED' then
    return { "ERROR_ALREADY_SUBMITTED", 0, "0" }
end

if serverNow > (deadline + graceMs) then
    return { "ERROR_EXPIRED", 0, tostring(deadline) }
end

-- 3. Version checking (monotonic increment & idempotency)
local rawExisting = redis.call('HGET', answersKey, questionId)
if rawExisting then
    local ok, parsed = pcall(cjson.decode, rawExisting)
    if ok and parsed and parsed.version then
        local storedVersion = tonumber(parsed.version)
        if version < storedVersion then
            -- Out of order stale write: return stored version without overwriting
            return { "STALE_VERSION", storedVersion, tostring(parsed.serverTs or 0) }
        elseif version == storedVersion then
            -- Duplicate write retry (idempotent): acknowledge original
            return { "DUPLICATE_VERSION", storedVersion, tostring(parsed.serverTs or 0) }
        end
    end
end

-- 4. Persist to Redis Hash
local payload = cjson.encode({
    answer = answer,
    version = version,
    clientTs = tonumber(clientTs) or 0,
    serverTs = serverNow
})
redis.call('HSET', answersKey, questionId, payload)

-- 5. Enqueue to Redis Stream for durable background persistence
redis.call('XADD', 'stream:answers', '*',
    'examId', examId,
    'candidateId', candidateId,
    'questionId', questionId,
    'answer', answer,
    'version', tostring(version),
    'clientTs', clientTs,
    'serverTs', tostring(serverNow)
)

-- 6. Update candidate status
local answeredCount = redis.call('HLEN', answersKey)
redis.call('HMSET', statusKey,
    'lastSeen', serverNow,
    'answeredCount', answeredCount,
    'state', 'ACTIVE'
)
redis.call('ZADD', 'heartbeats:' .. examId, serverNow, candidateId)

return { "OK", version, tostring(serverNow), answeredCount }
