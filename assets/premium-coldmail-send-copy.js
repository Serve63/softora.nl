(function (global) {
  function isDailyLimitSkippedItem(item) {
    return Boolean(item && /Daglimiet/i.test(String(item.error || '')));
  }

  function isWebdesignNotReadySkippedItem(item) {
    return Boolean(item && /Nog geen website-design klaar/i.test(String(item.error || '')));
  }

  function formatColdmailSentCount(count) {
    return count + ' ' + (count === 1 ? 'mail' : 'mails') + ' verstuurd';
  }

  function formatTestRecipientLabel(sendResult) {
    const emails = Array.isArray(sendResult && sendResult.testRecipientEmails)
      ? sendResult.testRecipientEmails
      : [sendResult && sendResult.testRecipientEmail].filter(Boolean);
    return emails.length ? emails.join(' en ') : 'servec321@gmail.com';
  }

  function buildColdmailSendSuccessMessage(sendResult) {
    if (sendResult && sendResult.testMode) return 'Testmail verstuurd naar ' + formatTestRecipientLabel(sendResult) + '.';
    const sent = Number(sendResult && sendResult.sent) || 0;
    const failed = Number(sendResult && sendResult.failed) || 0;
    if (!failed) return '✓ ' + formatColdmailSentCount(sent);
    const failedItems = Array.isArray(sendResult && sendResult.failedItems) ? sendResult.failedItems : [];
    const dailyLimitSkipped = failedItems.filter(isDailyLimitSkippedItem).length;
    const webdesignNotReadySkipped = failedItems.filter(isWebdesignNotReadySkippedItem).length;
    const realFailed = Math.max(0, failed - dailyLimitSkipped - webdesignNotReadySkipped);
    if (realFailed > 0) return '✓ ' + formatColdmailSentCount(sent) + '. ' + realFailed + ' mislukt';
    if (dailyLimitSkipped > 0) return '✓ ' + formatColdmailSentCount(sent) + '. Daglimiet bereikt';
    if (webdesignNotReadySkipped > 0) return '✓ ' + formatColdmailSentCount(sent);
    return '✓ ' + formatColdmailSentCount(sent) + ' (' + failed + ' mislukt)';
  }

  global.SoftoraColdmailSendCopy = {
    buildColdmailSendSuccessMessage,
  };
  global.buildColdmailSendSuccessMessage = buildColdmailSendSuccessMessage;
})(typeof window !== 'undefined' ? window : globalThis);
