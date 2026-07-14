const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  createSafeNavigationGuard,
  isPrivateAddress,
  normalizeWebsiteUrl,
  validatePublicWebsiteUrl,
} = require('../../server/security/company-website-video-url');
const {
  buildVideoStoragePath,
  canReuseVideo,
  canTransitionStatus,
} = require('../../server/repositories/company-website-video');
const {
  buildFfmpegArgs,
} = require('../../server/services/company-website-video-renderer');
const { createWorker } = require('../../scripts/company-website-video-worker');

test('website-URL normalisatie accepteert alleen http(s)', () => {
  assert.equal(normalizeWebsiteUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeWebsiteUrl('HTTP://Example.COM:80/path#part'), 'http://example.com/path');
  assert.equal(normalizeWebsiteUrl('file:///etc/passwd'), '');
  assert.equal(normalizeWebsiteUrl('javascript:alert(1)'), '');
  assert.equal(normalizeWebsiteUrl('data:text/plain,test'), '');
  assert.equal(normalizeWebsiteUrl('ftp://example.com/file'), '');
});

test('websitevideo blokkeert localhost, private IPv4 en private IPv6', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.4.2', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  await assert.rejects(() => validatePublicWebsiteUrl('http://localhost'), /host|intern|onveilig/i);
  await assert.rejects(() => validatePublicWebsiteUrl('http://intranet'), /interne websitehost/i);
  await assert.rejects(() => validatePublicWebsiteUrl('https://example.test', {
    lookup: async () => [{ address: '192.168.1.20', family: 4 }],
  }), /privé-netwerkadres/i);
  assert.equal(await validatePublicWebsiteUrl('https://example.test/path', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  }), 'https://example.test/path');
});

test('redirectguard blokkeert een hoofdnavigatie naar een privéadres', async () => {
  const mainFrame = {};
  mainFrame.page = () => ({ mainFrame: () => mainFrame });
  let aborted = false;
  let continued = false;
  const guard = createSafeNavigationGuard({
    validate: (url) => validatePublicWebsiteUrl(url, {
      lookup: async () => [{ address: url.includes('private') ? '10.0.0.4' : '93.184.216.34', family: 4 }],
    }),
  });
  await guard({
    request: () => ({ isNavigationRequest: () => true, frame: () => mainFrame, url: () => 'https://private.example/' }),
    abort: async () => { aborted = true; },
    continue: async () => { continued = true; },
  });
  assert.equal(aborted, true);
  assert.equal(continued, false);
});

test('videoreuse, statusovergangen, opslagpad en FFmpeg-contract zijn strikt', () => {
  const record = { status: 'ready', videoPath: 'companies/c1/homepage.mp4', normalizedWebsiteUrl: 'https://example.com/' };
  assert.equal(canReuseVideo(record, 'https://example.com/', true), true);
  assert.equal(canReuseVideo(record, 'https://changed.example/', true), false);
  assert.equal(canReuseVideo(record, 'https://example.com/', false), false);
  assert.equal(canTransitionStatus('pending', 'processing'), true);
  assert.equal(canTransitionStatus('processing', 'ready'), true);
  assert.equal(canTransitionStatus('processing', 'failed'), true);
  assert.equal(canTransitionStatus('ready', 'processing'), false);
  assert.equal(buildVideoStoragePath('company/unsafe id'), 'companies/company_unsafe_id/homepage.mp4');
  const args = buildFfmpegArgs('raw.webm', 'overlay.png', 'final.mp4');
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.includes('-an'));
  assert.match(args.join(' '), /scale=1280:720/);
  assert.match(args.join(' '), /overlay=20:20/);
  assert.match(args.join(' '), /trim=duration=20/);
  const offsetArgs = buildFfmpegArgs('raw.webm', 'overlay.png', 'final.mp4', { startOffsetSeconds: 4.125 });
  assert.deepEqual(offsetArgs.slice(0, 4), ['-y', '-ss', '4.125', '-i']);
});


test('twee gelijktijdige workerclaims starten exact één render', async () => {
  let available = true;
  let renderCalls = 0;
  let readyCalls = 0;
  const repository = {
    configured: true,
    claimNext: async () => {
      if (!available) return null;
      available = false;
      return { companyId: 'c1', normalizedWebsiteUrl: 'https://example.com/' };
    },
    upload: async () => 'companies/c1/homepage.mp4',
    markReady: async () => { readyCalls += 1; },
    markFailed: async () => {},
  };
  const worker = createWorker({
    repository,
    renderer: async ({ outputPath }) => { renderCalls += 1; await fs.promises.writeFile(outputPath, 'mp4'); },
    logger: { log() {}, error() {} },
  });
  await Promise.all([worker.runOne(), worker.runOne()]);
  assert.equal(renderCalls, 1);
  assert.equal(readyCalls, 1);
});

test('mislukte render wordt server-side als failed opgeslagen', async () => {
  let failedMessage = '';
  const worker = createWorker({
    repository: {
      configured: true,
      claimNext: async () => ({ companyId: 'c1', normalizedWebsiteUrl: 'https://example.com/' }),
      markFailed: async (_companyId, _token, message) => { failedMessage = message; },
    },
    renderer: async () => { throw new Error('technische renderfout'); },
    logger: { log() {}, error() {} },
  });
  assert.equal(await worker.runOne(), true);
  assert.equal(failedMessage, 'technische renderfout');
});
