-- session_login.lua
-- Atomically registers or replaces an active session for a candidate.
-- Enforces: Single active session per candidate.
--
-- KEYS[1] = session:{candidateId}
-- ARGV[1] = candidateId
-- ARGV[2] = newSid (unique session ID)
-- ARGV[3] = deviceInfo (User-Agent, IP, etc.)
-- ARGV[4] = serverNow (timestamp in ms)
-- ARGV[5] = ttlSeconds (session expiration)

local key = KEYS[1]
local candidateId = ARGV[1]
local newSid = ARGV[2]
local deviceInfo = ARGV[3]
local serverNow = ARGV[4]
local ttlSeconds = tonumber(ARGV[5]) or 86400

-- 1. Read existing session if any
local oldSid = redis.call('HGET', key, 'sid')
local oldDevice = redis.call('HGET', key, 'deviceInfo')
local replaced = 0

if oldSid and oldSid ~= newSid then
    replaced = 1
    -- Publish session invalidation to pub/sub so connected WebSockets on any instance get notified immediately
    local payload = cjson.encode({
        type = "SESSION_REPLACED",
        candidateId = candidateId,
        oldSid = oldSid,
        newSid = newSid,
        replacedAt = serverNow,
        oldDevice = oldDevice or "unknown",
        newDevice = deviceInfo
    })
    redis.call('PUBLISH', 'channel:session_invalidated', payload)
end

-- 2. Store new session atomically
redis.call('HMSET', key, 
    'sid', newSid, 
    'deviceInfo', deviceInfo, 
    'createdAt', serverNow,
    'candidateId', candidateId
)
redis.call('EXPIRE', key, ttlSeconds)

-- Return replacement status and old session ID
return { replaced, oldSid or "" }
