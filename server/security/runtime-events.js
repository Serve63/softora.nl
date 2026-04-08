function createRuntimeEventStore(deps = {}) {
  const {
    recentDashboardActivities = [],
    recentSecurityAuditEvents = [],
    queueRuntimeStatePersist = () => {},
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    normalizePremiumSessionEmail = (value) => String(value || '').trim().toLowerCase(),
    normalizeIpAddress = (value) => String(value || '').trim(),
    normalizeOrigin = (value) => String(value || '').trim().toLowerCase(),
  } = deps;

  function createSecurityAuditEvent(input) {
    const nowIso = new Date().toISOString();
    const entryId = `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: normalizeString(input?.id || entryId),
      type: truncateText(normalizeString(input?.type || 'security_event'), 120) || 'security_event',
      severity: truncateText(normalizeString(input?.severity || 'info'), 20) || 'info',
      success: Boolean(input?.success),
      email: truncateText(normalizePremiumSessionEmail(input?.email || ''), 180),
      ip: truncateText(normalizeIpAddress(input?.ip || ''), 80),
      path: truncateText(normalizeString(input?.path || ''), 200),
      origin: truncateText(normalizeOrigin(input?.origin || ''), 200),
      detail: truncateText(normalizeString(input?.detail || input?.message || ''), 500),
      userAgent: truncateText(normalizeString(input?.userAgent || ''), 280),
      createdAt: normalizeString(input?.createdAt || nowIso) || nowIso,
    };
  }

  function appendSecurityAuditEvent(input, reason = 'security_audit') {
    const entry = createSecurityAuditEvent(input);
    recentSecurityAuditEvents.unshift(entry);
    if (recentSecurityAuditEvents.length > 500) {
      recentSecurityAuditEvents.length = 500;
    }
    queueRuntimeStatePersist(reason);
    return entry;
  }

  function createDashboardActivityEntry(input) {
    const nowIso = new Date().toISOString();
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: normalizeString(input?.id || entryId),
      type: normalizeString(input?.type || input?.action || 'dashboard_action'),
      title: truncateText(normalizeString(input?.title || ''), 200) || 'Dashboard actie',
      detail: truncateText(normalizeString(input?.detail || input?.description || ''), 500),
      company: truncateText(normalizeString(input?.company || ''), 120),
      source: truncateText(normalizeString(input?.source || 'premium-personeel-dashboard'), 80),
      actor: truncateText(normalizeString(input?.actor || ''), 120),
      taskId: Number.isFinite(Number(input?.taskId)) ? Number(input.taskId) : null,
      callId: truncateText(normalizeString(input?.callId || ''), 120),
      createdAt: normalizeString(input?.createdAt || nowIso) || nowIso,
    };
  }

  function appendDashboardActivity(input, reason = 'dashboard_activity') {
    const entry = createDashboardActivityEntry(input);
    recentDashboardActivities.unshift(entry);
    if (recentDashboardActivities.length > 500) {
      recentDashboardActivities.length = 500;
    }
    queueRuntimeStatePersist(reason);
    return entry;
  }

  return {
    appendDashboardActivity,
    appendSecurityAuditEvent,
    createDashboardActivityEntry,
    createSecurityAuditEvent,
  };
}

module.exports = {
  createRuntimeEventStore,
};
