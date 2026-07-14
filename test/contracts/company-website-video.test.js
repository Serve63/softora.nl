const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  calculateScrollFrame,
} = require('../../server/services/company-website-video-renderer');
const {
  createCompanyWebsiteVideoCoordinator,
} = require('../../server/services/company-website-video');
const {
  registerCompanyWebsiteVideoRoutes,
} = require('../../server/routes/company-website-video');
const { createWorker } = require('../../scripts/company-website-video-worker');

const repoRoot = path.resolve(__dirname, '../..');

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    sendFile(filePath) { this.filePath = filePath; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function createDataOpsStore(customers) {
  return { listCustomers: async () => customers };
}

function createRepository(overrides = {}) {
  return {
    configured: true,
    get: async () => null,
    exists: async () => false,
    queue: async (input) => ({ ...input, status: 'pending' }),
    download: async () => Buffer.from('video'),
    ...overrides,
  };
}

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
  const args = buildFfmpegArgs('frame-%06d.jpg', 'overlay.png', 'final.mp4');
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.includes('-an'));
  assert.match(args.join(' '), /scale=1280:720/);
  assert.match(args.join(' '), /overlay=20:20/);
  assert.match(args.join(' '), /trim=duration=20/);
  assert.deepEqual(args.slice(0, 7), ['-y', '-framerate', '30', '-start_number', '0', '-i', 'frame-%06d.jpg']);
});

test('scrollframes zijn monotoon, vloeiend en bevatten echte 30-fps-beweging', () => {
  const totalFrames = 600;
  const positions = Array.from({ length: totalFrames }, (_, index) => (
    calculateScrollFrame(index, totalFrames, 12_000, 720)
  ));
  assert.equal(positions[0], 0);
  assert.ok(positions[599] > 4_500);
  assert.ok(positions.every((position, index) => index === 0 || position >= positions[index - 1]));
  const movingFrames = positions.filter((position, index) => index > 0 && position !== positions[index - 1]);
  assert.ok(movingFrames.length > 480, `te weinig unieke scrollframes: ${movingFrames.length}`);
  const largestStep = Math.max(...positions.slice(1).map((position, index) => position - positions[index]));
  assert.ok(largestStep < 20, `scrollsprong te groot: ${largestStep}`);
});

test('film-icoon navigeert uitsluitend intern in hetzelfde tabblad', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/premium-database-webdesign-preview.js'), 'utf8');
  assert.match(source, /return "\/bedrijven\/" \+ encodeURIComponent\(normalizeString\(id\)\) \+ "\/video"/);
  assert.match(source, /aria-label=\\"Bekijk websitevideo\\" title=\\"Bekijk websitevideo\\"/);
  assert.doesNotMatch(source, /photo-video-link[^\n]+target=\\"_blank\\"/);
  assert.doesNotMatch(source, /photo-cinematic-video-link/);
  assert.match(source, /if \(link\) event\.stopPropagation\(\)/);
});

test('websitevideoroutes bieden vaste pagina, status, start en bestand', () => {
  const routes = [];
  const app = {
    get(pathname) { routes.push(['GET', pathname]); },
    post(pathname) { routes.push(['POST', pathname]); },
  };
  registerCompanyWebsiteVideoRoutes(app, { coordinator: {} });
  assert.deepEqual(routes, [
    ['GET', '/bedrijven/:companyId/video'],
    ['GET', '/api/bedrijven/:companyId/website-video'],
    ['POST', '/api/bedrijven/:companyId/website-video'],
    ['GET', '/api/bedrijven/:companyId/website-video/file'],
  ]);
});

test('coordinator haalt exact het bedrijf en de website uit de centrale database', async () => {
  const coordinator = createCompanyWebsiteVideoCoordinator({
    dataOpsStore: createDataOpsStore([
      { id: 'c1', bedrijf: 'Eerste', website: 'https://first.example' },
      { id: 'c2', bedrijf: 'Tweede', dom: 'second.example' },
    ]),
    repository: createRepository(),
  });
  const status = await coordinator.buildStatus('c2');
  assert.equal(status.companyId, 'c2');
  assert.equal(status.companyName, 'Tweede');
  assert.equal(status.websiteUrl, 'second.example');
  assert.equal(status.normalizedWebsiteUrl, 'https://second.example/');
});

test('bedrijf zonder website toont no_website en onbekend ID lekt niets', async () => {
  const coordinator = createCompanyWebsiteVideoCoordinator({
    dataOpsStore: createDataOpsStore([{ id: 'c1', bedrijf: 'Zonder website' }]),
    repository: createRepository(),
  });
  assert.equal((await coordinator.buildStatus('c1')).status, 'no_website');
  const response = createResponse();
  await coordinator.statusResponse({ params: { companyId: 'secret-does-not-exist' } }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { ok: false, error: 'Niet gevonden.' });
});

test('geldige bestaande video wordt direct hergebruikt zonder nieuwe queue', async () => {
  let queueCalls = 0;
  const repository = createRepository({
    get: async () => ({ companyId: 'c1', status: 'ready', videoPath: 'companies/c1/homepage.mp4', normalizedWebsiteUrl: 'https://reuse.example/', updatedAt: 'now' }),
    exists: async () => true,
    queue: async () => { queueCalls += 1; },
  });
  const coordinator = createCompanyWebsiteVideoCoordinator({
    dataOpsStore: createDataOpsStore([{ id: 'c1', bedrijf: 'Reuse', website: 'https://reuse.example' }]),
    repository,
  });
  const status = await coordinator.buildStatus('c1');
  assert.equal(status.status, 'ready');
  assert.equal(status.videoUrl, '/api/bedrijven/c1/website-video/file');
  assert.equal(queueCalls, 0);
});

test('ontbrekende of gewijzigde websitevideo wordt opnieuw ingepland', async () => {
  const queued = [];
  const repository = createRepository({
    get: async () => ({ companyId: 'c1', status: 'ready', videoPath: 'old.mp4', normalizedWebsiteUrl: 'https://old.example/' }),
    queue: async (input, options) => { queued.push({ input, options }); return { ...input, status: 'pending' }; },
  });
  const coordinator = createCompanyWebsiteVideoCoordinator({
    dataOpsStore: createDataOpsStore([{ id: 'c1', bedrijf: 'Gewijzigd', website: 'https://new.example' }]),
    repository,
  });
  const response = createResponse();
  await coordinator.startResponse({ params: { companyId: 'c1' }, body: {} }, response);
  assert.equal(response.statusCode, 202);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].input.normalizedWebsiteUrl, 'https://new.example/');
  assert.equal(queued[0].options.forceRetry, true);
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

test('videopagina bevat alleen speler, status, terugknop en retry', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'premium-company-website-video.html'), 'utf8');
  const client = fs.readFileSync(path.join(repoRoot, 'assets/premium-company-website-video.js'), 'utf8');
  assert.match(html, /Terug naar database/);
  assert.match(html, /Video wordt geladen\.\.\./);
  assert.match(html, /<video[^>]+controls[^>]+preload="metadata"/);
  assert.match(html, /Opnieuw proberen/);
  assert.doesNotMatch(html, /autoplay|upload|webcam|microfoon/i);
  assert.match(client, /POLL_INTERVAL_MS = 2500/);
  assert.match(client, /Voor dit bedrijf is geen geldige website gevonden\./);
  assert.match(client, /De video kon niet worden geladen\./);
  assert.doesNotMatch(`${html}\n${client}`, /video wordt gemaakt|video kon niet worden gemaakt/i);
});
