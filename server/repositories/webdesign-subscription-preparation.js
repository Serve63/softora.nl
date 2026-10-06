'use strict';
const { randomUUID } = require('node:crypto');

function createSubscriptionPreparationRepository({ getClient, heartbeat, now = Date.now }) {
  async function read(jobId, claim) {
    const live = await heartbeat(jobId, claim);
    if (!live.ok || !live.allowed) return null;
    const { data, error } = await getClient().from('softora_webdesign_jobs')
      .select('job_id,status,payload,updated_at').eq('job_id', jobId).maybeSingle();
    if (error) throw error;
    return data?.status === 'running' && data.payload?.executionProvider === 'codex-subscription'
      && data.payload.subscriptionClaim === claim && data.payload.cancelled !== true ? data : null;
  }

  async function write(row, claim, preparation, guard) {
    const previous = row.payload.subscriptionPreparation;
    let query = getClient().from('softora_webdesign_jobs').update({
      payload: { ...row.payload, subscriptionPreparation: preparation,
        ...(preparation.phase === 'ready' ? { subscriptionBrandGuard: guard || null } : {}) },
      updated_at: new Date(now()).toISOString(),
    }).eq('job_id', row.job_id).eq('status', 'running').eq('updated_at', row.updated_at)
      .eq('payload->>subscriptionClaim', claim);
    query = previous?.token ? query.eq('payload->subscriptionPreparation->>token', previous.token)
      .eq('payload->subscriptionPreparation->>phase', previous.phase)
      : query.is('payload->subscriptionPreparation->>token', null);
    const { data, error } = await query.select('job_id').maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  return {
    async beginPreparation(jobId, claim) {
      const row = await read(jobId, claim);
      if (!row) return { stopped: true };
      const state = row.payload.subscriptionPreparation || {};
      if (state.phase === 'ready' && state.workerJob?.id === jobId && state.workerJob.claim === claim) {
        return { ready: state.workerJob };
      }
      if (state.phase === 'failed') return { exhausted: true, error: state.error };
      if (Number(state.retryAt || state.leaseUntil) > now()) return { waiting: true };
      if (Number(state.attempts) >= 3) return { exhausted: true, error: state.error || 'Websiteanalyse bleef te lang duren.' };
      const preparation = { phase: 'preparing', token: randomUUID(), attempts: Number(state.attempts || 0) + 1,
        leaseUntil: now() + 300000 };
      return await write(row, claim, preparation) ? { preparation } : { waiting: true };
    },
    async savePreparation(jobId, claim, expected, result) {
      const preparation = { ...expected, ...result, leaseUntil: 0 };
      delete preparation.brandGuard;
      // A concurrent waiting poll heartbeats this same row. Refresh its snapshot
      // after a CAS conflict without spending another website-analysis attempt.
      for (let retry = 0; retry < 3; retry += 1) {
        const row = await read(jobId, claim);
        if (!row) return { stopped: true };
        const current = row.payload.subscriptionPreparation;
        if (current?.token !== expected.token || current.phase !== 'preparing') return { waiting: true };
        if (await write(row, claim, preparation, result.brandGuard)) return { ok: true };
      }
      return { ok: false, waiting: true };
    },
  };
}

module.exports = { createSubscriptionPreparationRepository };
