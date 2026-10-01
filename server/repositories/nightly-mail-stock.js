'use strict';

function createNightlyMailStockStore({ getSupabaseClient = () => null } = {}) {
  function client() {
    const value = getSupabaseClient({ timeoutMs: 15000, ignoreFailureCooldown: true, suppressFailureCooldown: true });
    if (!value) throw new Error('Nachtelijke voorraadopslag niet beschikbaar.');
    return value;
  }
  async function result(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  async function rpc(name, args) {
    const data = await result(client().rpc(name, args));
    if (!data || typeof data !== 'object') throw new Error('Geen bevestiging van voorraadopslag.');
    return data;
  }
  return {
    async readControl() {
      const data = await result(client().from('softora_mail_stock_control').select('*').eq('id', 'nightly').single());
      if (!data) throw new Error('Nachtelijke voorraadconfiguratie ontbreekt.');
      return data;
    },
    async readPlan(batchId) {
      return result(client().from('softora_mail_stock_generations').select('customer_id,provider,customer,status,identity_keys')
        .eq('batch_id', batchId).order('created_at', { ascending: true }));
    },
    async readActiveJobs() {
      const rows = await result(client().from('softora_webdesign_jobs').select('customer_id,payload')
        .in('status', ['queued', 'running']).limit(5000));
      if (!Array.isArray(rows) || rows.length >= 5000) throw new Error('Actieve ontwerpvoorraad niet volledig leesbaar.');
      return rows;
    },
    allocate(customer, provider, identityKeys, batchId) {
      return rpc('softora_mail_stock_allocate', { p_customer: customer, p_provider: provider, p_keys: identityKeys, p_batch_id: batchId });
    },
    reserve(customerId, jobId, readyIds) {
      return rpc('softora_mail_stock_reserve', { p_customer_id: customerId, p_job_id: jobId, p_ready_ids: readyIds });
    },
    settle(customerId, jobId, chargeCents, generation) {
      return rpc('softora_mail_stock_settle', {
        p_customer_id: customerId, p_job_id: jobId, p_charge_cents: chargeCents, p_generation: generation,
      });
    },
    async recordCheck(day, summary) {
      await result(client().from('softora_mail_stock_control').update({ last_check_day: day, last_result: summary, updated_at: new Date().toISOString() })
        .eq('id', 'nightly').select('id').single());
    },
  };
}

module.exports = { createNightlyMailStockStore };
