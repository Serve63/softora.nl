'use strict';
const { normalizeWebdesignJobRow } = require('../services/webdesign-job-payload');
const { createSubscriptionPreparationRepository } = require('./webdesign-subscription-preparation');

function createWebdesignSubscriptionRepository({ getSupabaseClient = () => null } = {}) {
  function getClient() {
    const client = getSupabaseClient({ timeoutMs: 30000, ignoreFailureCooldown: true });
    if (!client) throw new Error('Abonnementopdrachten niet bereikbaar.');
    return client;
  }
  async function rpc(action, args) {
    const client = getClient();
    const { data, error } = await client.rpc('softora_webdesign_subscription_' + action, args);
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('Geen bevestiging van opdrachtopslag.');
    return { ...data, job: data.job ? normalizeWebdesignJobRow(data.job) : null };
  }
  const heartbeat = (jobId, claim) => rpc('result', { p_job_id: jobId, p_claim: claim, p_action: 'heartbeat', p_error: '' });
  return {
    ...createSubscriptionPreparationRepository({ getClient, heartbeat }),
    claim: (claim) => rpc('claim', { p_claim: claim }),
    heartbeat,
    begin: (jobId, claim) => rpc('result', { p_job_id: jobId, p_claim: claim, p_action: 'begin', p_error: '' }),
    storeBrandGuard: (jobId, claim, guard) => rpc('guard', { p_job_id: jobId, p_claim: claim, p_guard: guard }),
    finish: (jobId, claim, error = '') => rpc('result', { p_job_id: jobId, p_claim: claim, p_action: error ? 'error' : 'done', p_error: error }),
  };
}
module.exports = { createWebdesignSubscriptionRepository };
