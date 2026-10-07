'use strict';
const { parseDocument, DomUtils } = require('htmlparser2');
const { removeHiddenWebsitePreviewContent } = require('./website-visible-html');
const { detectPlaceholderWebsiteScan, detectPlatformWebsiteUrl } = require('./website-preview-placeholder');

// Match page headings and short error documents, never provider names or error
// words quoted in a substantive business page.
const ERROR_PAGE = /apache is functioning normally|apache2 (?:ubuntu|debian) default page|welcome to nginx|web server.s default page|default web site page|^it works!?$|^iis windows server$|^index of \/|this site can.t be reached|website not configured|no website configured|account (?:has been )?suspended|error establishing a database connection|critical error on this website|kritieke fout opgetreden|^(?:404(?: not found)?|page not found|pagina niet gevonden|forbidden|access denied|500 internal server error|502 bad gateway|503 service unavailable)$/i;
const SECURITY_PAGE = /verify you are human|checking your browser|just a moment|complete the captcha|captcha verification required|enable javascript and cookies to continue/i;

function detectWebsiteSourceProblem(scan = {}) {
  const headings = [scan.title, scan.h1].map(v => String(v || '').trim());
  const text = String(scan.bodyTextSample || '').trim();
  const platform = detectPlatformWebsiteUrl(scan.sourceUrl || scan.url);
  if (platform) return { code: 'WEBDESIGN_PLATFORM_WEBSITE', reason: 'geen eigen website (social/platform)' };
  const placeholder = detectPlaceholderWebsiteScan(scan);
  if (placeholder.placeholder) return { code: 'WEBDESIGN_PLACEHOLDER_WEBSITE', reason: 'in aanbouw, onderhoud of geparkeerd' };
  if (text.length < 1500 && /wij werken aan (?:een|onze) nieuwe website|we are working on (?:a|our) new website/i.test(text)) {
    return { code: 'WEBDESIGN_PLACEHOLDER_WEBSITE', reason: 'in aanbouw, onderhoud of geparkeerd' };
  }
  if (headings.some(v => ERROR_PAGE.test(v)) || (text.length < 1500 && ERROR_PAGE.test(text))) {
    return { code: 'WEBDESIGN_ERROR_PAGE', reason: 'standaard- of foutpagina' };
  }
  if (headings.some(v => SECURITY_PAGE.test(v)) || (text.length < 1000 && SECURITY_PAGE.test(text))) {
    return { code: 'WEBDESIGN_SOURCE_BLOCKED', reason: 'beveiligings- of laadscherm' };
  }
  // Use measured visible text, not HTML bytes: script bundles can make an empty
  // application or loading screen appear to contain a large amount of content.
  if (Number.isFinite(scan.visibleTextLength) && scan.visibleTextLength < 200) {
    return { code: 'WEBDESIGN_EMPTY_WEBSITE', reason: 'lege pagina of te weinig leesbare inhoud' };
  }
  return null;
}

function websiteSourceError(problem) {
  return Object.assign(new Error(`Websitebron onbruikbaar: ${problem.reason}. Er is geen webdesign gemaakt.`),
    { status: 422, code: problem.code, retryableWebsiteFetch: false });
}

function scanWebsiteSourceHtml(html, url) {
  const document = parseDocument(removeHiddenWebsitePreviewContent(html));
  const find = name => DomUtils.findOne(node => node.name === name, document.children, true);
  const title = DomUtils.textContent(find('title') || {}).trim();
  const h1 = DomUtils.textContent(find('h1') || {}).trim();
  const body = find('body');
  const text = DomUtils.textContent(body || document).replace(/\s+/g, ' ').trim();
  return { title, h1, bodyTextSample: text.slice(0, 5000), visibleTextLength: text.length, sourceUrl: url };
}

module.exports = { detectWebsiteSourceProblem, websiteSourceError, scanWebsiteSourceHtml };
