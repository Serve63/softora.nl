const crypto = require('crypto');
const { resolveMailboxName } = require('./mailbox-sent-copy');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  markMailboxCampaignSnapshotRead,
  markMailboxCampaignSnapshotReplyDismissed,
} = require('./mailbox-campaign-snapshot');

const MUTATION_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{7,127}$/i;
const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;
const SOURCE_READ_DEADLINE_MS = 5_000;

function createMailboxReadMessageService(deps = {}) {
  const {
    canUseMailboxIndex = () => false,
    mailboxIndexStore,
    getAccount,
    parseMessageReference,
    createClient,
    instantlyMailboxService,
    getUiStateValues,
    setUiStateValues,
    logger = console,
    now = () => new Date(),
  } = deps;

  function normalize(value) {
    return String(value || '').trim();
  }

  function normalizeEmail(value) {
    return normalize(value).toLowerCase();
  }

  function createSafeError(message, code, status = 503, retryable = status >= 500) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.retryable = retryable;
    return error;
  }

  function isRetryableIndexError(error) {
    const text = normalize(error && (error.code || error.message || error));
    return /abort|timeout|timed out|504|503|502|429|408|fetch|network|temporar|cooldown|pgrst/i.test(text);
  }

  function normalizeMutationRequest(input = {}) {
    const suppliedId = normalize(input.mutationId || input.idempotencyKey);
    const mutationId = MUTATION_ID_PATTERN.test(suppliedId) ? suppliedId : crypto.randomUUID();
    const suppliedRevision = Number(input.revision);
    const revision = Number.isSafeInteger(suppliedRevision) && suppliedRevision > 0
      ? Math.min(MAX_SAFE_REVISION, suppliedRevision)
      : Math.min(MAX_SAFE_REVISION, Math.max(1, now().getTime() * 1000));
    return {
      mutationId,
      revision,
      unread: input.unread === true,
      dismissReply: input.dismissReply === true,
    };
  }

  function buildMutationKey(target, mutation) {
    return crypto.createHash('sha256').update([
      'mailbox-state-v1',
      normalizeEmail(target.accountEmail),
      normalize(target.folder).toLowerCase(),
      Number(target.uid) || 0,
      normalize(target.id),
      mutation.mutationId,
    ].join('|')).digest('hex');
  }

  async function resolveTarget({ accountEmail, id, folder, uid, owner }) {
    const normalizedFolder = normalize(folder || 'inbox').toLowerCase();
    if (normalizedFolder === 'instantly') {
      if (typeof instantlyMailboxService?.assertStoredMessageOwnership !== 'function') {
        throw createSafeError('Instantly-mailbox is tijdelijk niet beschikbaar.', 'INSTANTLY_MAILBOX_UNAVAILABLE', 503, true);
      }
      const providerMessageId = normalize(id).replace(/^instantly:/i, '');
      const stored = await instantlyMailboxService.assertStoredMessageOwnership({
        owner,
        accountEmail,
        providerMessageId,
      });
      return {
        accountEmail: normalizeEmail(stored.providerAccountEmail),
        folder: 'instantly',
        uid: 0,
        id: `instantly:${normalize(stored.providerMessageId)}`,
        provider: 'instantly',
      };
    }

    const account = getAccount(accountEmail);
    if (!account) throw createSafeError('Mailbox-account niet gevonden.', 'MAILBOX_ACCOUNT_NOT_FOUND', 404, false);
    if (!account.imapConfigured) {
      throw createSafeError('IMAP is niet geconfigureerd voor deze mailbox.', 'MAILBOX_IMAP_NOT_CONFIGURED', 503, false);
    }
    const messageRef = parseMessageReference({ id, folder: normalizedFolder, uid });
    return {
      accountEmail: normalizeEmail(account.email),
      folder: messageRef.folder,
      uid: messageRef.uid,
      id: normalize(id) || `${messageRef.folder}:${messageRef.uid}`,
      provider: 'imap',
      account,
    };
  }

  async function persistSnapshotState(target, mutation, row) {
    if (typeof getUiStateValues !== 'function' || typeof setUiStateValues !== 'function') return false;
    try {
      const current = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
      const rawValue = current?.values?.[MAILBOX_CAMPAIGN_SNAPSHOT_KEY] || '';
      const identity = {
        accountEmail: target.accountEmail,
        id: target.id,
        folder: target.folder,
        uid: target.uid,
      };
      const snapshotResult = mutation.dismissReply
        ? markMailboxCampaignSnapshotReplyDismissed(rawValue, identity, {
            dismissedAt: normalize(row?.reply_dismissed_at) || now().toISOString(),
          })
        : markMailboxCampaignSnapshotRead(rawValue, identity, {
            readAt: normalize(row?.softora_read_at) || now().toISOString(),
          });
      if (!snapshotResult.changed) return false;
      await setUiStateValues(
        MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
        { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: snapshotResult.serialized },
        { source: mutation.dismissReply ? 'mailbox-reply-dismiss' : 'mailbox-read', actor: target.accountEmail }
      );
      return true;
    } catch (error) {
      logger.warn('[Mailbox][StateSnapshot][SoftError]', error?.message || error);
      return false;
    }
  }

  async function markSourceReadBestEffort(target) {
    if (target.provider !== 'imap' || !target.account || !target.uid) return false;
    const task = (async () => {
      const client = createClient(target.account);
      try {
        await client.connect();
        const mailboxName = await resolveMailboxName(client, target.folder);
        const lock = await client.getMailboxLock(mailboxName);
        try {
          await client.messageFlagsAdd([target.uid], ['\\Seen'], { uid: true });
          return true;
        } finally {
          lock.release();
        }
      } finally {
        try {
          if (client.usable) await client.logout();
        } catch (_) {}
      }
    })().catch((error) => {
      logger.warn('[Mailbox][SourceRead][Deferred]', error?.code || error?.name || 'provider_read_failed');
      return false;
    });
    let timer = null;
    try {
      return await Promise.race([
        task,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), SOURCE_READ_DEADLINE_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function assertDurableMutationAvailable() {
    if (!canUseMailboxIndex() || typeof mailboxIndexStore?.applyStateMutation !== 'function') {
      throw createSafeError(
        'Mailboxstatus kan tijdelijk niet duurzaam worden opgeslagen.',
        'MAILBOX_STATE_STORE_UNAVAILABLE',
        503,
        true
      );
    }
  }

  function assertDurableStatusAvailable() {
    assertDurableMutationAvailable();
    if (typeof mailboxIndexStore?.getStateMutationStatus !== 'function') {
      throw createSafeError(
        'Mailboxstatus kan tijdelijk niet worden gecontroleerd.',
        'MAILBOX_STATE_STATUS_UNAVAILABLE',
        503,
        true
      );
    }
  }

  async function applyMutation(target, mutation) {
    assertDurableMutationAvailable();
    const mutationKey = buildMutationKey(target, mutation);
    const result = await mailboxIndexStore.applyStateMutation({
      ...target,
      mutationKey,
      revision: mutation.revision,
      unread: mutation.unread,
      dismissReply: mutation.dismissReply,
    });
    if (result?.ok !== true || !result.row) {
      const sourceError = result?.error;
      if (sourceError?.code === 'MAILBOX_INDEX_MESSAGE_NOT_FOUND' || sourceError?.code === 'P0002') {
        throw createSafeError('Mailboxbericht is niet meer beschikbaar.', 'MAILBOX_STATE_MESSAGE_NOT_FOUND', 404, false);
      }
      throw createSafeError(
        'Mailboxstatus wordt later opnieuw opgeslagen.',
        'MAILBOX_STATE_TEMPORARY',
        503,
        isRetryableIndexError(sourceError)
      );
    }
    return { mutationKey, result, row: result.row };
  }

  async function markMessageRead(input = {}) {
    const mutation = normalizeMutationRequest(input);
    const target = await resolveTarget(input);
    const applied = await applyMutation(target, mutation);
    const snapshotUpdated = await persistSnapshotState(target, mutation, applied.row);
    const sourceMailboxMutated = mutation.unread ? false : await markSourceReadBestEffort(target);
    return {
      account: target.accountEmail,
      folder: target.folder,
      uid: target.uid,
      id: target.id,
      unread: Boolean(applied.row.unread),
      replyDismissedAt: normalize(applied.row.reply_dismissed_at),
      mutationId: mutation.mutationId,
      revision: Number(applied.row.current_revision) || mutation.revision,
      replayed: applied.row.replayed === true,
      superseded: applied.row.superseded === true,
      snapshotUpdated,
      sourceMailboxMutated,
    };
  }

  async function getMessageReadStatus(input = {}) {
    assertDurableStatusAvailable();
    const mutation = normalizeMutationRequest(input);
    const target = await resolveTarget(input);
    const mutationKey = buildMutationKey(target, mutation);
    const status = await mailboxIndexStore.getStateMutationStatus(target);
    if (status?.ok !== true) {
      throw createSafeError('Mailboxstatus wordt later opnieuw gecontroleerd.', 'MAILBOX_STATE_STATUS_TEMPORARY', 503, true);
    }
    const row = status.row;
    const currentRevision = Math.max(0, Number(row?.state_revision) || 0);
    return {
      mutationId: mutation.mutationId,
      revision: mutation.revision,
      confirmed: Boolean(row && row.state_mutation_key === mutationKey && currentRevision === mutation.revision),
      superseded: Boolean(row && currentRevision > mutation.revision),
      currentRevision,
      unread: row ? Boolean(row.unread) : null,
      replyDismissedAt: normalize(row?.reply_dismissed_at),
    };
  }

  return { getMessageReadStatus, markMessageRead };
}

module.exports = { createMailboxReadMessageService };
