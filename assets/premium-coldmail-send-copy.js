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

  function buildColdmailSendSuccessMessage(sendResult) {
    if (sendResult && sendResult.testMode) return 'Testmail verstuurd naar servec321@gmail.com.';
    const sent = Number(sendResult && sendResult.sent) || 0;
    const failed = Number(sendResult && sendResult.failed) || 0;
    if (!failed) return '✓ ' + formatColdmailSentCount(sent);
    const failedItems = Array.isArray(sendResult && sendResult.failedItems) ? sendResult.failedItems : [];
    const dailyLimitSkipped = failedItems.filter(isDailyLimitSkippedItem).length;
    const webdesignNotReadySkipped = failedItems.filter(isWebdesignNotReadySkippedItem).length;
    const realFailed = Math.max(0, failed - dailyLimitSkipped - webdesignNotReadySkipped);
    const resultParts = [
      dailyLimitSkipped ? dailyLimitSkipped + ' overgeslagen door daglimiet' : '',
      webdesignNotReadySkipped ? webdesignNotReadySkipped + ' overgeslagen: website-design nog niet klaar' : '',
      realFailed ? realFailed + ' mislukt' : '',
    ].filter(Boolean);
    if (resultParts.length) {
      return '✓ ' + formatColdmailSentCount(sent) + '. ' + resultParts.join(', ');
    }
    return '✓ ' + formatColdmailSentCount(sent) + ' (' + failed + ' mislukt)';
  }

  global.SoftoraColdmailSendCopy = {
    buildColdmailSendSuccessMessage,
  };
  global.buildColdmailSendSuccessMessage = buildColdmailSendSuccessMessage;
})(typeof window !== 'undefined' ? window : globalThis);
