const { CAMPAIGN_MAILBOX_ACCOUNTS } = require('./mailbox-campaign-replies');

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

module.exports = {
  selectMailboxSyncAccounts,
};
