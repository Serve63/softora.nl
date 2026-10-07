const crypto = require('node:crypto');

const MAX_CALL_MS = 90000;
const MAX_TOTAL_TOKENS = 8000;
const MAX_TURNS = 6;

// A temporary capability for one isolated call, never a global AI enable switch.
function createMathijsCallTestGate({ enabled = '', tokenSha256 = '', expiresAt = '', to = '', now = Date.now } = {}) {
  let used = false;
  const expiry = Date.parse(expiresAt);
  const digest = /^[a-f0-9]{64}$/.test(tokenSha256) ? Buffer.from(tokenSha256, 'hex') : null;
  const allowedNumber = /^\+316\d{8}$/.test(to) ? to : '';
  return {
    claim(token) {
      const time = now();
      if (used || enabled !== 'true' || !digest || !allowedNumber || !Number.isFinite(expiry) ||
          expiry <= time || expiry > time + 600000 || !/^[a-f0-9]{64}$/.test(token)) return null;
      const supplied = crypto.createHash('sha256').update(token).digest();
      if (!crypto.timingSafeEqual(supplied, digest)) return null;
      used = true;
      let tokens = 0;
      let turns = 0;
      return {
        maxOutputTokens: 256,
        matchesStart(start, parameters) {
          return /^CA[a-f0-9]{32}$/i.test(String(start?.callSid || '')) && parameters?.to === allowedNumber;
        },
        observeUsage(message) {
          const usage = message.usageMetadata || message.usage_metadata;
          if (usage) {
            const total = Number(usage.totalTokenCount ?? usage.total_token_count);
            if (!Number.isFinite(total) || total < 0) return 'test-invalid-usage';
            tokens += total;
            if (tokens >= MAX_TOTAL_TOKENS) return 'test-token-limit';
          }
          const content = message.serverContent || message.server_content;
          if (content?.turnComplete || content?.turn_complete) turns += 1;
          return turns >= MAX_TURNS ? 'test-turn-limit' : '';
        },
        armStop(stop, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
          const timer = setTimer(() => stop('test-time-limit'), MAX_CALL_MS);
          timer?.unref?.();
          return () => clearTimer(timer);
        },
      };
    },
  };
}

module.exports = { createMathijsCallTestGate, MAX_CALL_MS, MAX_TOTAL_TOKENS, MAX_TURNS };
