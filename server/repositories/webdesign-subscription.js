'use strict';
const { normalizeWebdesignJobRow } = require('../services/webdesign-job-payload');

function createWebdesignSubscriptionRepository({ getSupabaseClient = () => null } = {}) {
  async function rpc(action, args) {
    const client = getSupabaseClient({ timeoutMs: 30000, ignoreFailureCooldown: true });
    if (!client) throw new Error('Abonnementopdrachten niet bereikbaar.');
    const { data, error } = await client.rpc('softora_webdesign_subscription_' + action, args);
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('Geen bevestiging van opdrachtopslag.');
    return { ...data, job: data.job ? normalizeWebdesignJobRow(data.job) : null };
  }
  return {
    claim: (claim) => rpc('claim', { p_claim: claim }),
    heartbeat: (jobId, claim) => rpc('result', { p_job_id: jobId, p_claim: claim, p_action: 'heartbeat', p_error: '' }),
    begin: (jobId, claim) => rpc('result', { p_job_id: jobId, p_claim: claim, p_action: 'begin', p_error: '' }),
    finish: (jobId, claim, error = '') => rpc('result', { p_job_id: jobId, p_claim: claim, p_action: error ? 'error' : 'done', p_error: error }),
  };
}
module.exports = { createWebdesignSubscriptionRepository };
