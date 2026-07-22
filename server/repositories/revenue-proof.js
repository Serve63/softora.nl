const TABLE_NAME = 'softora_revenue_proof_events';

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    eventKey: normalizeString(row.event_key),
    eventKind: normalizeString(row.event_kind),
    orderId: normalizeString(row.order_id),
    amountEur: row.amount_eur === null || row.amount_eur === undefined
      ? null
      : Number(row.amount_eur),
    source: normalizeString(row.source),
    externalEventId: normalizeString(row.external_event_id),
    automationRunId: normalizeString(row.automation_run_id),
    evidenceHash: normalizeString(row.evidence_hash),
    autonomous: Boolean(row.autonomous),
    occurredAt: normalizeString(row.occurred_at),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: normalizeString(row.created_at),
  };
}

function toRow(event) {
  return {
    event_key: event.eventKey,
    event_kind: event.eventKind,
    order_id: event.orderId,
    amount_eur: event.amountEur,
    source: event.source,
    external_event_id: event.externalEventId,
    automation_run_id: event.automationRunId || null,
    evidence_hash: event.evidenceHash,
    autonomous: Boolean(event.autonomous),
    occurred_at: event.occurredAt,
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
  };
}

function createRepositoryError(operation, source) {
  const error = new Error(
    `${operation} mislukt: ${normalizeString(source?.message) || 'onbekende databasefout'}`
  );
  error.code = 'REVENUE_PROOF_STORAGE_FAILED';
  error.cause = source;
  return error;
}

function createRevenueProofRepository(options = {}) {
  const getClient = () => options.client || (
    typeof options.getSupabaseClient === 'function'
      ? options.getSupabaseClient()
      : null
  );

  async function appendEvents(events = []) {
    const client = getClient();
    if (!client) {
      const error = new Error('Revenue-proof opslag is niet geconfigureerd.');
      error.code = 'REVENUE_PROOF_STORAGE_UNCONFIGURED';
      throw error;
    }
    const rows = events.map(toRow);
    if (!rows.length) return [];
    const result = await client
      .from(TABLE_NAME)
      .upsert(rows, { onConflict: 'event_key', ignoreDuplicates: true })
      .select('*');
    if (result?.error) throw createRepositoryError('Revenue-proof events opslaan', result.error);
    return (result?.data || []).map(normalizeRow);
  }

  async function listEvents(options = {}) {
    const client = getClient();
    if (!client) {
      const error = new Error('Revenue-proof opslag is niet geconfigureerd.');
      error.code = 'REVENUE_PROOF_STORAGE_UNCONFIGURED';
      throw error;
    }
    let query = client
      .from(TABLE_NAME)
      .select('*')
      .order('occurred_at', { ascending: true })
      .limit(Math.max(1, Math.min(5000, Number(options.limit) || 5000)));
    if (options.from) query = query.gte('occurred_at', options.from);
    if (options.to) query = query.lt('occurred_at', options.to);
    const result = await query;
    if (result?.error) throw createRepositoryError('Revenue-proof events ophalen', result.error);
    return (result?.data || []).map(normalizeRow);
  }

  return {
    appendEvents,
    configured: Boolean(getClient()),
    listEvents,
  };
}

module.exports = {
  TABLE_NAME,
  createRevenueProofRepository,
  normalizeRow,
  toRow,
};
