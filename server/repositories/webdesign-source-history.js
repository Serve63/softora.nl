'use strict';

function createWebdesignSourceHistoryRepository({ run, TABLES, getWebdesignStatusReadOptions, createWebdesignJobStatusReadError }) {
  return { async listWebdesignSourceHistory(ownerKey, customerIds) {
    const rows = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const result = await run('webdesign-source-history', (client) => client.from(TABLES.webdesignJobs)
        .select('job_id,customer_id,website_url,status,error,created_at,updated_at,finished_at,preparationPhase:payload->subscriptionPreparation->>phase,preparationCode:payload->subscriptionPreparation->>errorCode,rejected:payload->sourceQualityRejected')
        .eq('owner_key', ownerKey).in('customer_id', customerIds).in('status', ['done', 'error'])
        .order('updated_at', { ascending: false }).order('job_id', { ascending: false })
        .range(offset, offset + 499), getWebdesignStatusReadOptions());
      if (!result.ok || !Array.isArray(result.data)) throw createWebdesignJobStatusReadError(result);
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
    }
    throw new Error('De bronhistorie is te groot om volledig te controleren.');
  } };
}

module.exports = { createWebdesignSourceHistoryRepository };
