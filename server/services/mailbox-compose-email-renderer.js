'use strict';

const { renderWebdesignEmailDocument } = require('./webdesign-email-renderer');

const MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION = 'softora-mailbox-compose-2026-08-05-v1';
const MAILBOX_COMPOSE_PARAGRAPH_STYLE = [
  'margin:0 0 18px 0',
  'font-family:Arial,sans-serif',
  'font-size:16px',
  'line-height:26px',
  'color:#1a1a2e',
  'max-width:100%',
  'overflow-wrap:anywhere',
  'word-break:normal',
  '-webkit-text-size-adjust:100%',
  '-ms-text-size-adjust:100%',
  'text-size-adjust:100%',
].join(';');
const MAILBOX_COMPOSE_LINK_STYLE = 'color:#0b57d0;text-decoration:underline;';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSafeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function trimBareUrlPunctuation(value) {
  let url = String(value || '');
  let suffix = '';
  while (/[.,!?;:]$/.test(url)) {
    suffix = `${url.slice(-1)}${suffix}`;
    url = url.slice(0, -1);
  }
  while (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
    suffix = `)${suffix}`;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}

function renderSafeLink(href, label) {
  const safeHref = normalizeSafeHttpUrl(href);
  if (!safeHref) return escapeHtml(label);
  return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer" style="${MAILBOX_COMPOSE_LINK_STYLE}">${escapeHtml(label)}</a>`;
}

function renderComposeLine(value) {
  const source = String(value || '');
  const pattern = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s<>"']+)\)|(https?:\/\/[^\s<>"']+)/gi;
  let rendered = '';
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    rendered += escapeHtml(source.slice(cursor, match.index));
    if (match[1] && match[2]) {
      rendered += renderSafeLink(match[2], match[1]);
    } else {
      const { url, suffix } = trimBareUrlPunctuation(match[3]);
      rendered += `${renderSafeLink(url, url)}${escapeHtml(suffix)}`;
    }
    cursor = Number(match.index) + match[0].length;
  }
  return `${rendered}${escapeHtml(source.slice(cursor))}`;
}

function renderMailboxComposeEmailHtml(value) {
  const bodyText = String(value || '').replace(/\r\n?/g, '\n');
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split('\n').map(renderComposeLine).join('<br>'))
    .filter(Boolean)
    .map((paragraph) => `<p style="${MAILBOX_COMPOSE_PARAGRAPH_STYLE}">${paragraph}</p>`)
    .join('\n');
  const content = paragraphs || `<p style="${MAILBOX_COMPOSE_PARAGRAPH_STYLE}">&nbsp;</p>`;
  return renderWebdesignEmailDocument(
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;margin:0;padding:0;"><tr><td align="left" style="margin:0;padding:0;"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;margin:0;padding:0;"><tr><td class="softora-webdesign-email-body softora-mailbox-compose-body" data-softora-template-version="${MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION}" style="font-family:Arial,sans-serif;font-size:16px;line-height:26px;color:#1a1a2e;width:100%;max-width:600px;min-width:0;box-sizing:border-box;overflow-wrap:anywhere;word-break:normal;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;text-size-adjust:100%;">${content}</td></tr></table></td></tr></table>`
  );
}

module.exports = {
  MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION,
  renderMailboxComposeEmailHtml,
  renderComposeLine,
};
