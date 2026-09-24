// Retry only failed read batches; never turn an incomplete guard read into an empty set.
async function readOutboundGuardKeys({ run, table, normalizeString, defaultTimeoutMs }, guardKeys, options = {}) {
  const keys = Array.from(new Set((Array.isArray(guardKeys) ? guardKeys : []).map(normalizeString).filter(Boolean)));
  if (!keys.length) return [];
  const chunks = [];
  for (let index = 0; index < keys.length; index += 100) chunks.push(keys.slice(index, index + 100));
  const found = new Set();
  let cursor = 0, failed = false;
  async function worker() {
    while (!failed && cursor < chunks.length) {
      const chunk = chunks[cursor++];
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        result = await run('list-outbound-recipient-guard-keys', client => client.from(table)
          .select('guard_key').in('guard_key', chunk).in('status', ['sent', 'reserved']).limit(chunk.length), {
          timeoutMs: Math.max(1000, Math.min(30000, Number(options.timeoutMs) || defaultTimeoutMs)),
          bypassReadFailureCooldown: attempt > 0 || options.bypassReadFailureCooldown,
          suppressReadFailureCooldown: options.suppressReadFailureCooldown,
          suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
        });
        if (result.ok && Array.isArray(result.data)) break;
      }
      if (!result?.ok || !Array.isArray(result.data)) { failed = true; return; }
      result.data.forEach(row => { const key = normalizeString(row?.guard_key); if (key) found.add(key); });
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
  return failed ? null : Array.from(found);
}

async function readGuardSetWithRetry(read) {
  const first = await read();
  return first === null ? read() : first;
}
module.exports = { readOutboundGuardKeys, readGuardSetWithRetry };
