const { ensureRequiredRef } = require('./agenda');

function normalizeString(value) {
  return String(value ?? '').trim();
}

function parseBooleanQuery(value) {
  return /^(1|true|yes)$/i.test(String(value || ''));
}

function parseLimit(value, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(1000, numeric));
}

function validateAgendaAppointmentsListRequest(req) {
  return {
    ok: true,
    query: {
      limit: String(parseLimit(req.query?.limit, 200)),
      fresh: String(parseBooleanQuery(req.query?.fresh || req.query?.forceSync)),
    },
  };
}

function validateConfirmationTasksListRequest(req) {
  return {
    ok: true,
    query: {
      includeDemo: String(parseBooleanQuery(req.query?.includeDemo)),
      quick: String(parseBooleanQuery(req.query?.quick || req.query?.fast)),
      countOnly: String(parseBooleanQuery(req.query?.countOnly || req.query?.count_only)),
      fresh: String(parseBooleanQuery(req.query?.fresh || req.query?.forceSync)),
      limit: String(parseLimit(req.query?.limit, 100)),
    },
  };
}

function validateInterestedLeadsListRequest(req) {
  return {
    ok: true,
    query: {
      countOnly: String(parseBooleanQuery(req.query?.countOnly || req.query?.count_only)),
      fresh: String(parseBooleanQuery(req.query?.fresh || req.query?.forceSync)),
      limit: String(parseLimit(req.query?.limit, 100)),
    },
  };
}

function validateConfirmationTaskDetailRequest(req) {
  const taskId = ensureRequiredRef(req.params?.id || req.query?.taskId, 'taskId');
  if (!taskId.ok) return taskId;

  return {
    ok: true,
    params: req.params?.id ? { id: taskId.value } : undefined,
    query: req.query?.taskId !== undefined ? { taskId: taskId.value } : undefined,
  };
}

module.exports = {
  parseBooleanQuery,
  parseLimit,
  validateAgendaAppointmentsListRequest,
  validateConfirmationTaskDetailRequest,
  validateConfirmationTasksListRequest,
  validateInterestedLeadsListRequest,
  normalizeString,
};
