'use strict';
function createMailboxMessageResponse({ getMessage, enrich, logger }) {
  return async function getMessageResponse(req, res) {
    try {
      const original = await getMessage({
        accountEmail: req.query?.account,
        folder: req.query?.folder || 'inbox',
        id: req.query?.id || req.query?.message || '',
      });
      const [enriched] = await enrich([{ ...original, accountEmail: original.accountEmail || req.query?.account }]);
      const { sourceHtml, ...message } = enriched;
      return res.status(200).json({ ok: true, message });
    } catch (error) {
      logger.error('[Mailbox][Message]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mailboxbericht laden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }
}
module.exports = { createMailboxMessageResponse };
