(function (global) {
  'use strict';

  const BLOCKS = new Set(['DIV', 'P', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'UL', 'OL', 'TR', 'TABLE']);
  const OMIT = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'SVG', 'IMG']);
  const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/[\t ]+\n/g, '\n').replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  function textOf(node) {
    if (node?.nodeType === 3) {
      const text = node.textContent || '';
      return /^[\s\u00a0]+$/.test(text) && /[\r\n]/.test(text) ? '' : text;
    }
    if (!node || node.nodeType !== 1) return '';
    const tag = node.tagName;
    if (OMIT.has(tag) || node.hidden || (node.getAttribute('aria-hidden') === 'true' && !node.classList.contains('detail-mail-line-empty')) ||
        node.classList.contains('detail-footer')) return '';
    if (tag === 'BR' || node.classList.contains('detail-mail-line-empty')) return '\n';
    if (node.parentElement?.classList.contains('detail-routing')) {
      return `${node.querySelector('span')?.textContent.trim() || ''} ${node.querySelector('strong')?.textContent.trim() || ''}\n`;
    }
    const content = Array.from(node.childNodes).map(textOf).join('');
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      return /^https?:\/\//i.test(href) && content.trim() !== href ? `${content} (${href})` : content;
    }
    return BLOCKS.has(tag) ? `${content}\n` : content;
  }

  function buildConversationText(detail) {
    const body = detail?.querySelector('.detail-body-text');
    if (!body || detail.hasAttribute('inert') || body.querySelector('.detail-mail-loading, .detail-mail-load-error')) {
      throw new Error('Het gesprek is nog niet volledig geladen. Probeer opnieuw.');
    }
    const title = detail.querySelector('.detail-subject')?.textContent.trim();
    const rootRouting = detail.querySelector('.detail-header > .detail-routing');
    const content = clean(textOf(body));
    if (!content) throw new Error('Er is geen gesprek om te kopiëren.');
    return [title ? `Gesprek: ${title}` : '', rootRouting ? clean(textOf(rootRouting)) : '', content].filter(Boolean).join('\n\n');
  }

  function renderButton(id, escapeHtml) {
    return `<button class="detail-copy-conversation" type="button" data-mailbox-action="copy-conversation" data-mailbox-id="${escapeHtml(id)}" aria-label="Hele gesprek kopiëren" title="Hele gesprek kopiëren"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/></svg></button>`;
  }

  async function writeText(text, options = {}) {
    const clipboard = options.clipboard || global.navigator?.clipboard;
    if (clipboard?.writeText) return clipboard.writeText(text);
    const document = options.document || global.document;
    const previousFocus = document?.activeElement;
    const field = document?.createElement('textarea');
    if (!field) throw new Error('Kopiëren is niet beschikbaar in deze browser.');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(field);
    try {
      field.select();
      if (!document.execCommand?.('copy')) throw new Error('Kopiëren is niet gelukt. Probeer opnieuw.');
    } finally { field.remove(); previousFocus?.focus?.({ preventScroll: true }); }
  }

  function create(options = {}) {
    let flight = null;
    const scope = () => JSON.stringify(options.getScope?.() || {});
    const document = options.document || global.document;
    function busy(id, value) {
      document?.querySelectorAll('.detail-copy-conversation').forEach((button) => {
        if (button.getAttribute('data-mailbox-id') !== id) return;
        button.disabled = value;
        button.setAttribute('aria-busy', String(value));
      });
    }
    async function copy(id) {
      id = String(id || '');
      if (flight || !id || String(options.getActiveId?.()) !== id || !options.getMail?.(id)) return false;
      const currentScope = scope(), token = options.getToken?.();
      const current = () => String(options.getActiveId?.()) === id && scope() === currentScope &&
        (!options.isTokenCurrent || options.isTokenCurrent(token));
      flight = { id };
      busy(id, true);
      try {
        await options.getPending?.(id);
        if (!current()) return false;
        await options.openMail?.(id, { skipReadPersist: true, skipContactTimeline: true, skipThreadBodyFetch: true, preserveVisibleDetail: true });
        if (!current()) return false;
        let mail = options.getMail(id);
        const discovery = options.getDiscovery?.();
        if (options.getScope?.()?.folder === 'outreach') {
          await options.whenAccountsReady?.();
          if (!current()) return false;
          if (!mail.contactTimelineLoaded || mail.contactTimelineNeedsRefresh || mail.contactTimelineError) {
            if (!await discovery?.loadContactTimeline?.(mail, { force: true, deferRender: true, signal: token?.signal })) {
              throw new Error('Het volledige gesprek kon niet worden geladen. Probeer opnieuw.');
            }
          }
          const cursors = new Set();
          while (current() && mail.contactTimelineNextCursor) {
            const cursor = mail.contactTimelineNextCursor;
            if (cursors.has(cursor)) throw new Error('Het volledige gesprek kon niet worden geladen. Probeer opnieuw.');
            cursors.add(cursor);
            if (!await discovery.loadContactTimeline(mail, { append: true, deferRender: true, signal: token?.signal })) {
              throw new Error('Het volledige gesprek kon niet worden geladen. Probeer opnieuw.');
            }
          }
          if (mail.contactTimelinePendingMessages?.length) throw new Error('Het volledige gesprek kon niet worden geladen. Probeer opnieuw.');
        }
        if (!current()) return false;
        const index = options.getIndex?.();
        const needsData = (message) => index?.needsThreadBodyHydration?.(message) || index?.needsThreadRoutingHydration?.(message);
        const messages = Array.isArray(mail.threadMessages) ? mail.threadMessages : [];
        for (let offset = 0; offset < messages.length; offset += 40) {
          const targets = messages.slice(offset, offset + 40).filter(needsData);
          if (!targets.length) continue;
          await index.loadThreadBodies({ mail, targetMessages: targets, retryFailed: true, signal: token?.signal,
            isCurrent: current, getActiveMail: options.getActiveId, normalizeBodyImages: options.normalizeBodyImages,
            normalizeOptOutUrl: options.normalizeOptOutUrl });
          if (!current()) return false;
          if (targets.some(needsData)) throw new Error('Niet alle berichten konden worden geladen. Probeer opnieuw.');
        }
        if (!current()) return false;
        mail = options.getMail(id);
        if (mail.bodyLoading || mail.bodyTruncated || mail.bodyLoadError || mail.safeBodyPreviewOnly ||
            (mail.bodyLoaded === false && (mail.hasBody || mail.body || mail.preview)) ||
            mail.threadMessages?.some((message) => message.bodyLoading || message.bodyLoadError || needsData(message))) {
          throw new Error('Niet alle berichten konden worden geladen. Probeer opnieuw.');
        }
        await options.openMail?.(id, { skipBodyFetch: true, skipThreadBodyFetch: true, skipContactTimeline: true, skipReadPersist: true, preserveVisibleDetail: true });
        if (!current()) return false;
        const detail = document.getElementById('mail-detail');
        if (String(detail?.dataset.mailboxCommittedId) !== id) return false;
        const text = buildConversationText(detail);
        await writeText(text, { document, clipboard: options.clipboard });
        if (current()) options.toast?.('Hele gesprek gekopieerd');
        return true;
      } catch (error) {
        if (current()) options.toast?.(error.message || 'Kopiëren is niet gelukt. Probeer opnieuw.');
        return false;
      } finally { flight = null; busy(id, false); }
    }
    return { copy };
  }

  const api = { buildConversationText, create, renderButton, textOf, writeText };
  global.SoftoraMailboxCopy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
