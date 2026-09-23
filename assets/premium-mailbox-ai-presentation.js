(function (global) {
  'use strict';
  const VERSION = 'mailbox-luna-v1';
  const MODEL = 'gpt-6-luna';
  const labels = ['authored', 'signature', 'quote', 'uncertain'];
  const sourceBody = (message) => typeof message?.body === 'string' ? message.body : '';
  const linesOf = (body) => body.split(/\r?\n/);
  function isPhone(value) {
    const normalized = value.normalize('NFKC').replace(/\p{Pd}/gu, '-');
    const match = /^(?:\+|00)?([\d ()./-]{7,40})(?:\s+(?:ext\.?|toestel)\s*\d{1,6})?$/i.exec(normalized);
    const digits = match ? (match[1].match(/\d/g) || []).length : 0;
    return digits >= 7 && digits <= 15;
  }
  function validate(body, decision) {
    const lines = linesOf(body);
    if (!decision || !Array.isArray(decision.labels) || decision.labels.length !== lines.length ||
      decision.labels.some((label) => !labels.includes(label)) || !Array.isArray(decision.contacts) ||
      decision.contacts.length > 40) return false;
    // An empty message after filtering is never accepted as a successful extraction.
    if (!lines.some((line, i) => line.trim() && ['authored', 'uncertain', 'quote'].includes(decision.labels[i]))) return false;
    return decision.contacts.every((contact) => contact && Number.isInteger(contact.line) &&
      contact.line >= 0 && contact.line < lines.length && decision.labels[contact.line] === 'signature' &&
      ['phone', 'address'].includes(contact.kind) && typeof contact.text === 'string' &&
      contact.text.trim() === contact.text && contact.text.length > 0 && contact.text.length <= 200 &&
      !/[\r\n<>]/.test(contact.text) && lines[contact.line].includes(contact.text) &&
      (contact.kind !== 'phone' || isPhone(contact.text)));
  }
  function read(message) {
    const value = message?.aiPresentation;
    if (!value || value.reason === 'outside_scope') return null;
    const body = sourceBody(message);
    if (value.version === VERSION && value.status === 'pending' && value.gate === true) {
      return { body: 'Deze e-mail wordt opgeschoond. De inhoud verschijnt automatisch zodra dit klaar is.',
        contact: { beforeLines: [], addressLines: [] }, signatureMatched: false, aiManaged: true };
    }
    const notices = { failed: 'AI-opschoning is niet gelukt. Hieronder staat de originele e-mail.',
      timeout: 'AI-opschoning duurt langer dan verwacht. Hieronder staat de originele e-mail.',
      budget: 'AI-opschoning wacht op beschikbare budgetruimte. Hieronder staat de originele e-mail.',
      storage: 'AI-opschoning is tijdelijk niet beschikbaar. Hieronder staat de originele e-mail.' };
    if (value.version !== VERSION || value.status !== 'ready' || value.model !== MODEL || value.reasoningEffort !== 'max' ||
      value.sourceBody !== body || !validate(body, value.decision)) {
      return { body: notices[value.reason] ? `${notices[value.reason]}\n\n${body}` : body, contact: { beforeLines: [], addressLines: [] }, signatureMatched: false, aiManaged: true };
    }
    // Quote ownership is not evidence that content is irrelevant. Only signature labels may hide source lines.
    const lines = linesOf(body), labels = value.decision.labels;
    const visible = new Set(labels.flatMap((label, index) => label !== 'signature' ? [index] : []));
    const nonempty = lines.flatMap((line, index) => line.trim() ? [index] : []);
    // A lone supposed signature line between retained content is an ambiguous boundary,
    // not enough evidence to hide a forwarded attribution or a personal addition.
    nonempty.forEach((index, position) => {
      const before = nonempty[position - 1], after = nonempty[position + 1];
      if (labels[index] === 'signature' && before !== undefined && after !== undefined &&
        labels[before] !== 'signature' && labels[after] !== 'signature') visible.add(index);
    });
    const kept = lines.filter((_, index) => visible.has(index));
    const contacts = value.decision.contacts.filter((contact) => !visible.has(contact.line)).sort((a, b) => a.line - b.line);
    return { body: kept.join('\n').replace(/\n(?:[\t ]*\n){2,}/g, '\n\n').trim(), aiManaged: true, signatureMatched: true,
      contact: { beforeLines: contacts.filter((c) => c.kind === 'phone').map((c) => `Tel: ${c.text}`),
        addressLines: contacts.filter((c) => c.kind === 'address').map((c) => c.text) } };
  }
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function renderBody(lines) {
    const anchor = (url, label) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;font-style:italic">${escape(label)}</a>`;
    const link = (text) => {
      const pattern = /\[([^\[\]\r\n]+)\]\((https?:\/\/[^\s<>"']+)\)|(https?:\/\/[^\s<>"']+)/g;
      let html = '', end = 0;
      for (const match of text.matchAll(pattern)) {
        html += escape(text.slice(end, match.index)) + anchor(match[2] || match[3], match[1] || match[3]);
        end = match.index + match[0].length;
      }
      return html + escape(text.slice(end));
    };
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
