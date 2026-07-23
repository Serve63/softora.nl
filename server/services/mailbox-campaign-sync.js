const { CAMPAIGN_MAILBOX_ACCOUNTS } = require('./mailbox-campaign-replies');
const { CAMPAIGN_HISTORY_SUBJECT_TERMS } = require('./mailbox-campaign-history-sync');

const PERSONAL_MAILBOX_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'tuta.com',
  'tutamail.com',
  'yahoo.com',
  'ymail.com',
]);

function isCampaignSubject(message = {}) {
  const subject = String(message?.subject || '').toLowerCase();
  return CAMPAIGN_HISTORY_SUBJECT_TERMS.some((term) => subject.includes(term.toLowerCase()));
}

function collectCampaignThreadReferenceIds(messages = []) {
  return Array.from(
    new Set(
      (Array.isArray(messages) ? messages : [])
        .filter(isCampaignSubject)
        .map((message) => String(message?.messageId || '').trim())
        .filter(Boolean)
    )
  );
}

function collectCampaignThreadRecipientTerms(messages = []) {
  const terms = new Set();
  (Array.isArray(messages) ? messages : []).filter(isCampaignSubject).forEach((message) => {
    const emailMatch = String(message?.email || message?.senderEmail || '')
      .trim()
      .toLowerCase()
      .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    const email = emailMatch ? emailMatch[0] : '';
    if (!email) return;
    terms.add(email);
    const domain = email.split('@')[1] || '';
    if (domain && !PERSONAL_MAILBOX_DOMAINS.has(domain)) terms.add(domain);
  });
  return Array.from(terms);
}

function selectMailboxSyncAccounts({
  accountEmail = '',
  accounts = [],
  assertReadableAccount,
  normalizeEmail,
  campaignOnly = false,
} = {}) {
  if (accountEmail) return [assertReadableAccount(accountEmail)];
  const readableAccounts = (Array.isArray(accounts) ? accounts : [])
    .filter((account) => account && account.imapConfigured);
  if (!campaignOnly) return readableAccounts;
  const campaignAccounts = new Set(CAMPAIGN_MAILBOX_ACCOUNTS.map(normalizeEmail));
  return readableAccounts.filter((account) => campaignAccounts.has(normalizeEmail(account.email)));
}

function createMailboxSyncService({
  mailboxIndexStore,
  assertReadableAccount,
  canUseMailboxIndex,
  fetchMessagesFromImap,
  getSafeLimit,
  getAccounts,
  normalizeEmail,
  normalizeFolder,
  logger = console,
  defaultFolders = ['inbox', 'sent'],
  defaultLimit = 50,
} = {}) {
  async function syncMailboxFolder({
    accountEmail,
    folder = 'inbox',
    limit = defaultLimit,
    force = false,
    campaignOnly = false,
  } = {}) {
    const account = assertReadableAccount(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    if (!canUseMailboxIndex()) {
      return { ok: false, skipped: true, reason: 'mailbox_index_unavailable' };
    }
    const lock = await mailboxIndexStore.acquireSyncLock({
      accountEmail: account.email,
      folder: normalizedFolder,
      force,
    });
    if (!lock.ok) {
      return { ok: true, skipped: true, reason: lock.locked ? 'locked' : 'lock_failed' };
    }

    try {
      const oldestIndexedCampaignUid =
        campaignOnly &&
        typeof mailboxIndexStore.getOldestMatchingMessageUid === 'function'
          ? await mailboxIndexStore.getOldestMatchingMessageUid({
              accountEmail: account.email,
              folder: normalizedFolder,
              subjectTerms: CAMPAIGN_HISTORY_SUBJECT_TERMS,
            })
          : 0;
      let threadReferenceIds = [];
      let threadRecipientTerms = [];
      let indexedUids = [];
      if (
        campaignOnly &&
        normalizedFolder === 'sent' &&
        typeof mailboxIndexStore.listAllMessagesForAccounts === 'function'
      ) {
        const indexedInboxMessages =
          (await mailboxIndexStore.listAllMessagesForAccounts({
            accountEmails: [account.email],
            folder: 'inbox',
          })) || [];
        const indexedSentMessages =
          (await mailboxIndexStore.listAllMessagesForAccounts({
            accountEmails: [account.email],
            folder: 'sent',
          })) || [];
        threadReferenceIds = collectCampaignThreadReferenceIds(indexedInboxMessages);
        threadRecipientTerms = collectCampaignThreadRecipientTerms(indexedInboxMessages);
        indexedUids = indexedSentMessages.map((message) => Number(message?.uid) || 0).filter(Boolean);
      }
      const messages = await fetchMessagesFromImap({
        account,
        folder: normalizedFolder,
        limit: getSafeLimit(limit),
        campaignHistory: campaignOnly,
        oldestIndexedCampaignUid,
        threadReferenceIds,
        threadRecipientTerms,
        indexedUids,
      });
      const saved = await mailboxIndexStore.upsertMessages({
        accountEmail: account.email,
        folder: normalizedFolder,
        messages,
      });
      if (!saved || saved.ok === false) {
        throw saved?.error || new Error('Mailbox-index opslaan mislukt');
      }
      const lastUid = messages.reduce((max, message) => Math.max(max, Number(message.uid) || 0), 0);
      await mailboxIndexStore.finishSync({
        accountEmail: account.email,
        folder: normalizedFolder,
        lockToken: lock.lockToken,
        messageCount: messages.length,
        lastUid,
      });
      return {
        ok: true,
        account: account.email,
        folder: normalizedFolder,
        synced: messages.length,
        upserted: saved.upserted || messages.length,
        historyBackfill: Boolean(campaignOnly),
        historyBeforeUid: Number(oldestIndexedCampaignUid) || 0,
        targetedThreadReferences: threadReferenceIds.length,
        targetedThreadRecipients: threadRecipientTerms.length,
      };
    } catch (error) {
      await mailboxIndexStore.finishSync({
        accountEmail: account.email,
        folder: normalizedFolder,
        lockToken: lock.lockToken,
        error: error?.message || error,
      }).catch(() => null);
      throw error;
    }
  }

  async function syncMailbox({
    accountEmail = '',
    folders = defaultFolders,
    limit = defaultLimit,
    force = false,
    campaignOnly = false,
  } = {}) {
    const accounts = selectMailboxSyncAccounts({
      accountEmail,
      accounts: getAccounts(),
      assertReadableAccount,
      normalizeEmail,
      campaignOnly,
    });
    const folderList = Array.from(
      new Set((Array.isArray(folders) && folders.length ? folders : defaultFolders).map(normalizeFolder))
    );
    const results = [];
    for (const account of accounts) {
      for (const folder of folderList) {
        try {
          results.push(await syncMailboxFolder({
            accountEmail: account.email,
            folder,
            limit,
            force,
            campaignOnly,
          }));
        } catch (error) {
          logger.error('[Mailbox][Sync]', account.email, folder, error?.message || error);
          results.push({
            ok: false,
            account: account.email,
            folder,
            error: String(error?.message || error || 'Mailbox sync mislukt'),
          });
        }
      }
    }
    return {
      ok: results.every((result) => result.ok !== false),
      results,
    };
  }

  return {
    syncMailbox,
    syncMailboxFolder,
  };
}

module.exports = {
  collectCampaignThreadRecipientTerms,
  collectCampaignThreadReferenceIds,
  createMailboxSyncService,
  selectMailboxSyncAccounts,
};
