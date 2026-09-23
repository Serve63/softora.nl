'use strict';
const { randomUUID } = require('node:crypto');
const { VERSION } = require('../../assets/premium-mailbox-ai-presentation');
const TABLE = 'softora_mailbox_ai_presentations';
function createMailboxAiRepository({ getClient } = {}) {
  async function run(query, signal = AbortSignal.timeout(5000)) {
    // Align the underlying HTTP deadline with this operation's outer deadline.
    // The shared client's default 1.5s is too short for background candidate queries.
    const client = getClient?.({ timeoutMs: 5000 });
    if (!client) throw new Error('MAILBOX_AI_STORAGE_UNAVAILABLE');
    const builder = query(client);
    const result = await (builder.abortSignal ? builder.abortSignal(signal) : builder);
    if (result.error) throw new Error('MAILBOX_AI_STORAGE_UNAVAILABLE');
    return result.data;
  }
  async function enqueue(sources) {
    if (!sources.length) return [];
    const unique = [...new Map(sources.map((source) => [source.id, source])).values()];
    const signal = AbortSignal.timeout(1200), rows = [];
    async function batch(items) {
      const read = () => run((client) => client.rpc('softora_mailbox_ai_states', { p_ids: items.map((source) => source.id) }), signal);
      const existing = await read(), known = new Set((existing || []).map((row) => row.id));
      const missing = items.filter((source) => !known.has(source.id));
      if (!missing.length) return existing;
      await run((client) => client.from(TABLE).upsert(missing.map((source) => ({
        id: source.id, version: VERSION, account_email: source.account,
        message_key: source.messageKey, source, status: source.unsupported ? 'failed' : 'queued',
      })), { onConflict: 'id', ignoreDuplicates: true }), signal);
      return read();
    }
    for (let offset = 0; offset < unique.length; offset += 160) {
      const chunks = [];
      for (let i = offset; i < Math.min(offset + 160, unique.length); i += 40) chunks.push(unique.slice(i, i + 40));
      rows.push(...(await Promise.all(chunks.map(batch))).flat());
    }
    return rows;
  }
  async function candidates() {
    return run((client) => client.rpc('softora_mailbox_ai_candidates', { p_limit: 20 }));
  }
  async function claim() {
    const rows = await run((client) => client.rpc('softora_claim_mailbox_ai', { p_token: randomUUID() }));
    return rows?.[0] || null;
  }
  async function finish(job, result, failedUsage = null) {
    return run((client) => client.from(TABLE).update({ status: result ? 'ready' : 'failed',
      decision: result?.decision || null, usage: result?.usage || failedUsage || null, finished_at: new Date().toISOString() })
      .eq('id', job.id).eq('claim_token', job.claim_token).eq('status', 'running'));
  }
  return { enqueue, candidates, claim, finish };
}
module.exports = { createMailboxAiRepository };
