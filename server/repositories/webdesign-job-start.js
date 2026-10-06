function createWebdesignJobStartRepository({ run, TABLES, normalizeString, getWebdesignStatusReadOptions,
  createWebdesignJobStatusReadError, isRegularWebdesignJobRow, normalizeWebdesignJobRow,
  buildWebdesignJobRow, getWriteOperationOptions, getWebdesignJob, forgetReads }) {
  async function findRunningWebdesignJob(ownerKey, customerId) {
    const result = await run('find-running-webdesign-job', (client) =>
      client
        .from(TABLES.webdesignJobs)
        .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
        .eq('owner_key', normalizeString(ownerKey))
        .eq('customer_id', normalizeString(customerId))
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      getWebdesignStatusReadOptions()
    );
    if (!result.ok) throw createWebdesignJobStatusReadError(result);
    if (!result.data || !isRegularWebdesignJobRow(result.data)) return null;
    return normalizeWebdesignJobRow(result.data);
  }

  async function findWebdesignBatchTargetJob(ownerKey, batchId, index) {
    const result = await run('find-webdesign-batch-target-job', (client) => client.from(TABLES.webdesignJobs)
      .select('job_id,owner_key,customer_id,website_url,status,error,payload,created_at,started_at,finished_at')
      .eq('owner_key', normalizeString(ownerKey))
      .contains('payload', { batchId, batchTargetIndex: index })
      .order('created_at', { ascending: true }).limit(1).maybeSingle(), getWebdesignStatusReadOptions());
    if (!result.ok) throw createWebdesignJobStatusReadError(result);
    return result.data && isRegularWebdesignJobRow(result.data) ? normalizeWebdesignJobRow(result.data) : null;
  }

  async function createWebdesignJobIfAbsent(job) {
    const row = buildWebdesignJobRow(job);
    const result = await run('create-webdesign-job-if-absent', (client) => client.from(TABLES.webdesignJobs)
      .upsert(row, { onConflict: 'job_id', ignoreDuplicates: true }), getWriteOperationOptions());
    if (!result.ok) return result;
    forgetReads('webdesign-jobs:*');
    const stored = await getWebdesignJob(job.id);
    return stored ? { ok: true, job: stored } : { ok: false };
  }

  return { findRunningWebdesignJob, findWebdesignBatchTargetJob, createWebdesignJobIfAbsent };
}

module.exports = { createWebdesignJobStartRepository };
