(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoftoraMailboxBootReadiness = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function assess({ folder, selectedId, mail, detail, contactDossierActive = false } = {}) {
    const id = String(selectedId || '');
    if (!id) return { selectedDetail: true, contactTimeline: true };
    const selected = mail && String(mail.id || '') === id;
    const selectedDetail = Boolean(selected && mail.bodyLoaded === true &&
      mail.bodyLoading !== true && mail.bodyTruncated !== true &&
      String(detail?.dataset?.mailboxCommittedId || '') === id);
    const timelineExpected = folder === 'outreach' && selected && contactDossierActive === true;
    const renderedTimelineComplete = detail?.querySelector?.('[data-contact-summary-state="complete"]') != null;
    const contactTimeline = !timelineExpected || Boolean(
      mail.contactTimelineLoaded === true && mail.contactTimelineNeedsRefresh !== true &&
      mail.contactTimelineLoading !== true && !mail.contactTimelineError &&
      Number(mail.contactTimelineTotal) > 0 && renderedTimelineComplete
    );
    return { selectedDetail, contactTimeline };
  }

  async function publish({ folder, selectedId, mail, detail, contactDossierActive, readiness, document } = {}) {
    const requiredData = { mailbox: true, accounts: true, ...assess({ folder, selectedId, mail, detail, contactDossierActive }) };
    return await readiness?.markReady?.({
      page: 'premium-mailbox', requiredData, actionsBound: true,
      requiredActions: ['#mail-items', '#mail-detail', '#mailbox-account-switcher'],
      requiredImages: document?.querySelectorAll?.('#mail-detail img') || [],
    }) === true;
  }

  return Object.freeze({ assess, publish });
});
