-- heartbeat.lua
-- Updates candidate heartbeat and presence state in Redis
-- KEYS[1] = status:{examId}:{candidateId}
-- KEYS[2] = heartbeats:{examId}
-- ARGV[1] = examId
-- ARGV[2] = candidateId
-- ARGV[3] = tabSwitchesDelta (number)
-- ARGV[4] = serverNow

local statusKey = KEYS[1]
local heartbeatsKey = KEYS[2]
local examId = ARGV[1]
local candidateId = ARGV[2]
local tabSwitchesDelta = tonumber(ARGV[3]) or 0
local serverNow = tonumber(ARGV[4])

if not serverNow then
    local rTime = redis.call('TIME')
    serverNow = (tonumber(rTime[1]) * 1000) + math.floor(tonumber(rTime[2]) / 1000)
end

-- Update sorted set score
redis.call('ZADD', heartbeatsKey, serverNow, candidateId)

-- Update status hash
local state = redis.call('HGET', statusKey, 'state') or 'ACTIVE'
if state == 'DISCONNECTED' then
    state = 'ACTIVE'
end

redis.call('HSET', statusKey, 'lastSeen', serverNow, 'state', state)

if tabSwitchesDelta > 0 then
    redis.call('HINCRBY', statusKey, 'tabSwitches', tabSwitchesDelta)
end

local updated = redis.call('HMGET', statusKey, 'state', 'lastSeen', 'tabSwitches', 'answeredCount')

return {
    updated[1] or 'ACTIVE',
    tonumber(updated[2]) or serverNow,
    tonumber(updated[3]) or 0,
    tonumber(updated[4]) or 0
}
