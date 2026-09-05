'use strict';

const { isBlockedLeadSourceUrl } = require('./lead-radar-source-policy');

// Google explicitly supplies these Atom URLs for RSS readers. Consuming a
// configured subscription is distinct from crawling Google's search pages.
function isGoogleAlertsFeed(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.google.com' &&
      !url.port && !url.username && !url.password && !url.search &&
      /^\/alerts\/feeds\/\d+\/\d+$/.test(url.pathname);
  } catch { return false; }
}

function discoveryPostUrl(value) {
  try {
    let url = new URL(value);
    if (['www.google.com', 'google.com'].includes(url.hostname) && url.pathname === '/url') {
      url = new URL(url.searchParams.get('url') || url.searchParams.get('q') || '');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isBlockedLeadSourceUrl(url)) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function parseDiscoveryFeed(body, feedUrl, parsePublicFeed) {
  return parsePublicFeed(body, feedUrl).map((item) => {
    const url = discoveryPostUrl(item.url);
    if (!url) return null;
    const hostname = new URL(url).hostname;
    const platform = /(^|\.)linkedin\.com$/.test(hostname) ? 'linkedin'
      : /(^|\.)facebook\.com$/.test(hostname) ? 'facebook' : 'web';
    return {
      ...item, url, platform, source_type: 'serp', source_verified: false,
      // An alert's timestamp is when Google found it, not when the buyer posted.
      published_at: null, source_verification_reason: null,
      external_id: url,
    };
  }).filter(Boolean);
}

module.exports = { isGoogleAlertsFeed, discoveryPostUrl, parseDiscoveryFeed };
