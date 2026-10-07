'use strict';
const { assertWebsitePreviewUrlIsPublic } = require('../server/security/public-url');
const { detectPlatformWebsiteUrl } = require('../server/services/website-preview-placeholder');
const { detectWebsiteSourceProblem, scanWebsiteSourceHtml } = require('../server/services/website-source-quality');

async function checkWebsite(website, { timeoutMs = 25000, fetchImpl = fetch,
  assertPublic = assertWebsitePreviewUrlIsPublic } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = String(website || '').trim();
    if (!url) return { ok: false, reason: 'website ontbreekt' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
    for (let hop = 0; hop < 6; hop++) {
      if (detectPlatformWebsiteUrl(url)) return { ok: false, reason: 'geen eigen website (social/platform)' };
      url = await assertPublic(url);
      if (controller.signal.aborted) throw new Error('Websitecontrole duurde te lang.');
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        url = new URL(response.headers.get('location'), url).href;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); return { ok: false, reason: `website geeft foutcode ${response.status}` }; }
      const type = response.headers.get('content-type') || '';
      if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
        await response.body?.cancel(); return { ok: false, reason: 'geen HTML-bedrijfswebsite' };
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body || []) {
        chunks.push(chunk); size += chunk.length;
        if (size >= 600000) break;
      }
      const scan = scanWebsiteSourceHtml(Buffer.concat(chunks).toString('utf8'), url);
      const problem = detectWebsiteSourceProblem(scan);
      return { ok: !problem, reason: problem?.reason || '', title: scan.title, finalUrl: url };
    }
    return { ok: false, reason: 'te veel redirects' };
  } catch (error) {
    const code = String(error.cause?.code || error.code || error.name || 'ERR');
    return { ok: false, reason: /CERT|SSL|TLS|LEAF|ISSUER|ALTNAME|EPROTO/i.test(code)
      ? `beveiligde verbinding (https) kapot: ${code}` : `website niet veilig bereikbaar: ${code}` };
  } finally { clearTimeout(timer); }
}

async function checkWebsites(websites, { concurrency = 8, onProgress, ...options } = {}) {
  const unique = [...new Set(websites.map(v => String(v || '').trim()))];
  const results = new Map();
  let next = 0, finished = 0;
  await Promise.all(Array.from({ length: Math.min(32, Math.max(1, concurrency)) }, async () => {
    while (next < unique.length) {
      const website = unique[next++];
      results.set(website, await checkWebsite(website, options));
      if (++finished % 100 === 0) onProgress?.(finished, unique.length);
    }
  }));
  return results;
}

module.exports = { checkWebsite, checkWebsites };
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; if (input.length > 1000000) process.exit(1); });
  process.stdin.on('end', async () => {
    try {
      const websites = JSON.parse(input);
      const results = await checkWebsites(Array.isArray(websites) ? websites : [websites]);
      process.stdout.write(JSON.stringify(Object.fromEntries(results)));
    } catch (_) { process.exitCode = 1; }
  });
}
