(function (global) {
  'use strict';
  const VERSION = 'mailbox-luna-v1';
  const MODEL = 'gpt-5.6-luna';
  const labels = ['authored', 'signature', 'quote', 'uncertain'];
  const sourceBody = (message) => typeof message?.body === 'string' ? message.body : '';
  const linesOf = (body) => body.split(/\r?\n/);
  function validate(body, decision) {
    const lines = linesOf(body);
    if (!decision || !Array.isArray(decision.labels) || decision.labels.length !== lines.length ||
      decision.labels.some((label) => !labels.includes(label)) || !Array.isArray(decision.contacts) ||
      decision.contacts.length > 40) return false;
    // An empty message after filtering is never accepted as a successful extraction.
    if (!lines.some((line, i) => line.trim() && ['authored', 'uncertain'].includes(decision.labels[i]))) return false;
    return decision.contacts.every((contact) => contact && Number.isInteger(contact.line) &&
      contact.line >= 0 && contact.line < lines.length && decision.labels[contact.line] === 'signature' &&
      ['phone', 'address'].includes(contact.kind) && typeof contact.text === 'string' &&
      contact.text.trim() === contact.text && contact.text.length > 0 && contact.text.length <= 200 &&
      !/[\r\n<>]/.test(contact.text) && lines[contact.line].includes(contact.text) &&
      (contact.kind !== 'phone' || ((contact.text.match(/\d/g) || []).length >= 7 && /^(?:\+|00)?[\d ()./-]{7,40}(?:\s+(?:ext\.?|toestel)\s*\d{1,6})?$/i.test(contact.text))));
  }
  function read(message) {
    const value = message?.aiPresentation;
    if (!value) return null;
    const body = sourceBody(message);
    if (value.version !== VERSION || value.status !== 'ready' || value.model !== MODEL || value.reasoningEffort !== 'max' ||
      value.sourceBody !== body || !validate(body, value.decision)) {
      return { body, contact: { beforeLines: [], addressLines: [] }, signatureMatched: false, aiManaged: true };
    }
    const kept = linesOf(body).filter((_, index) => ['authored', 'uncertain'].includes(value.decision.labels[index]));
    const contacts = value.decision.contacts.slice().sort((a, b) => a.line - b.line);
    return { body: kept.join('\n').trim(), aiManaged: true, signatureMatched: true,
      contact: { beforeLines: contacts.filter((c) => c.kind === 'phone').map((c) => `Tel: ${c.text}`),
        addressLines: contacts.filter((c) => c.kind === 'address').map((c) => c.text) } };
  }
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function renderBody(lines) {
    const link = (text) => text.split(/(https?:\/\/[^\s<>"']+)/g).map((part) => /^https?:\/\//.test(part)
      ? `<a href="${escape(part)}" target="_blank" rel="noopener noreferrer" style="color:inherit;font-style:italic">${escape(part)}</a>` : escape(part)).join('');
    return `<div class="detail-mail-lines">${lines.map((line) => `<div class="detail-mail-line${line.trim() ? '' : ' detail-mail-line-empty'}">${line.trim() ? link(line) : '&nbsp;'}</div>`).join('')}</div>`;
  }
  function renderContact(contact) {
    const phones = [...new Set(contact.beforeLines || [])].map((line) => line.replace(/^Tel: /, ''));
    const addresses = [...new Set(contact.addressLines || [])];
    if (!phones.length && !addresses.length) return '';
    const field = (label, lines) => `<div class="detail-mail-contact-item"><dt>${label}:</dt><dd>${lines.map((line) => `<div>${escape(line)}</div>`).join('')}</dd></div>`;
    return `<address class="detail-mail-contact-card" aria-label="Contactgegevens uit handtekening"><dl class="detail-mail-contact-grid">${phones.length ? field('Telefoon', phones) : ''}${addresses.length ? field('Adres', addresses) : ''}</dl></address>`;
  }
  const api = { renderBody, renderContact, VERSION, MODEL, labels, sourceBody, linesOf, validate, read };
  global.SoftoraMailboxAiPresentation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
