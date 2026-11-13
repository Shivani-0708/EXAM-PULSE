-- rate_limit.lua
-- Custom Token Bucket Rate Limiter implemented directly in Redis Lua
-- KEYS[1] = ratelimit:{key}
-- ARGV[1] = capacity (maximum burst tokens)
-- ARGV[2] = refillRate (tokens per second)
-- ARGV[3] = requested (tokens to consume, usually 1)
-- ARGV[4] = serverNow (current epoch timestamp in milliseconds)

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local serverNow = tonumber(ARGV[4])

-- Read bucket state
local bucket = redis.call('HMGET', key, 'tokens', 'lastUpdated')
local tokens = tonumber(bucket[1])
local lastUpdated = tonumber(bucket[2])

if not tokens or not lastUpdated then
    -- Initial state: bucket full
    tokens = capacity
    lastUpdated = serverNow
else
    -- Compute token refill based on elapsed time
    local elapsedSec = math.max(0, (serverNow - lastUpdated) / 1000.0)
    tokens = math.min(capacity, tokens + (elapsedSec * refillRate))
    lastUpdated = serverNow
end

local allowed = 0
local retryAfterMs = 0

if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
else
    local missingTokens = requested - tokens
    retryAfterMs = math.ceil((missingTokens / refillRate) * 1000)
    allowed = 0
end

-- Save state
redis.call('HMSET', key, 'tokens', tokens, 'lastUpdated', lastUpdated)
-- Expire bucket after time to completely refill to capacity + margin
local ttl = math.ceil(capacity / refillRate) + 60
redis.call('EXPIRE', key, ttl)

return { allowed, math.floor(tokens), retryAfterMs }
