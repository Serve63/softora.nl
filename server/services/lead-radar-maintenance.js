'use strict';

const DAY_MS = 86_400_000;
const DEFAULT_SIGNAL_RETENTION_DAYS = 90;
const DEFAULT_SCAN_RUN_RETENTION_DAYS = 180;
const MAX_CLEANUP_BATCH = 500;

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function boundedDays(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(7, Math.min(3_650, Math.round(parsed))) : fallback;
}

function createLeadRadarMaintenance({ getDb = () => null, env = process.env, logger = console } = {}) {
  async function idsFor(db, configure) {
    let query = db.from('softora_social_lead_signals').select('id');
    query = configure(query).limit(MAX_CLEANUP_BATCH);
    const result = await query;
    if (result.error) throw result.error;
    return (result.data || []).map((row) => row.id).filter(Boolean);
  }

  async function deleteIds(db, table, ids) {
    if (!ids.length) return 0;
    const result = await db.from(table).delete().in('id', ids);
    if (result.error) throw result.error;
    return ids.length;
  }

  async function cleanup() {
    const db = getDb();
    if (!db) return { status: 'storage_unavailable', deletedSignals: 0, deletedRuns: 0 };
    const signalCutoff = daysAgo(boundedDays(env.LEAD_RADAR_RETENTION_DAYS, DEFAULT_SIGNAL_RETENTION_DAYS));
    const runCutoff = daysAgo(boundedDays(env.LEAD_RADAR_SCAN_RUN_RETENTION_DAYS, DEFAULT_SCAN_RUN_RETENTION_DAYS));
    const idGroups = await Promise.all([
      idsFor(db, (query) => query.eq('lead_status', 'not_relevant').lt('updated_at', signalCutoff)),
      idsFor(db, (query) => query.eq('lead_status', 'archived').lt('updated_at', signalCutoff)),
      idsFor(db, (query) => query.eq('lead_status', 'new').eq('source_type', 'serp').lt('published_at', signalCutoff)),
    ]);
    const signalIds = Array.from(new Set(idGroups.flat()));
    const deletedSignals = await deleteIds(db, 'softora_social_lead_signals', signalIds);
    const oldRuns = await db.from('softora_social_lead_scan_runs').select('id').lt('started_at', runCutoff).limit(MAX_CLEANUP_BATCH);
    if (oldRuns.error) throw oldRuns.error;
    const deletedRuns = await deleteIds(db, 'softora_social_lead_scan_runs', (oldRuns.data || []).map((row) => row.id).filter(Boolean));
    return { status: 'completed', deletedSignals, deletedRuns, signalCutoff, runCutoff };
  }

  return { cleanup };
}

module.exports = { createLeadRadarMaintenance, DEFAULT_SIGNAL_RETENTION_DAYS, DEFAULT_SCAN_RUN_RETENTION_DAYS };
