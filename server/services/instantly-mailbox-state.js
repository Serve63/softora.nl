'use strict';

const INSTANTLY_MAILBOX_SYNC_SCOPE = 'instantly_mailbox_sync';
const READ_OPTIONS = Object.freeze({
  includeRevision: true, preferSupabaseRestRead: true,
  bypassReadFailureCooldown: true, suppressReadFailureCooldown: true,
  suppressReadFailureLog: true, ignoreSupabaseRestFailureCooldown: true,
  suppressSupabaseRestFailureCooldown: true,
});

// Continuations and provider backoffs share one existing state row. Every writer
// must preserve the other keys and retry a conflicting revision atomically.
async function patchInstantlyMailboxState({ getUiStateValues, compareAndSwapUiStateValues }, patch, meta = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await getUiStateValues(INSTANTLY_MAILBOX_SYNC_SCOPE, READ_OPTIONS);
    if (!current || current.source !== 'supabase') return null;
    const values = { ...current.values };
    for (const [key, value] of Object.entries(patch)) {
      values[key] = /^(?:read_cooldown_|lead_scope_cooldown_|thread_audit_)/.test(key)
        ? String(Math.max(Number(values[key]) || 0, Number(value) || 0))
        : value;
    }
    const result = await compareAndSwapUiStateValues(INSTANTLY_MAILBOX_SYNC_SCOPE, values, {
      ...meta, expectedRevision: current.revision,
      expectedUpdatedAt: current.updatedAt,
    });
    if (result?.ok) return result;
    if (!result?.conflict) return null;
  }
  return null;
}

module.exports = { INSTANTLY_MAILBOX_SYNC_SCOPE, patchInstantlyMailboxState, READ_OPTIONS };
