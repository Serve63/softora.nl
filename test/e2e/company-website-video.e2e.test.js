const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const ffmpegPath = require('ffmpeg-static');
const {
  probeVideo,
  renderCompanyWebsiteVideo,
  runProcess,
} = require('../../server/services/company-website-video-renderer');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function testHomepage() {
  const sections = Array.from({ length: 8 }, (_, index) => `
    <section style="height:720px;display:grid;place-items:center;background:hsl(${index * 42} 52% ${index % 2 ? 34 : 82}%);color:${index % 2 ? '#fff' : '#151515'}">
      <div><h2 style="font-size:72px;margin:0">Sectie ${index + 1}</h2><p style="font-size:28px">Veilige lokale websitevideo-test</p></div>
    </section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;font-family:Arial,sans-serif}</style></head><body><header style="height:720px;display:grid;place-items:center;background:#f5e8ef"><h1 style="font-size:78px">Testbedrijf</h1></header>${sections}</body></html>`;
}

async function pixelDifference(firstPath, secondPath, region) {
  const first = await sharp(firstPath).extract(region).removeAlpha().raw().toBuffer();
  const second = await sharp(secondPath).extract(region).removeAlpha().raw().toBuffer();
  let total = 0;
  for (let index = 0; index < first.length; index += 1) total += Math.abs(first[index] - second[index]);
  return total / first.length;
}

test('echte homepage scrollt, wordt H.264 MP4 en houdt het lege videovak vast', { timeout: 90_000 }, async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'softora-video-e2e-'));
  const outputPath = path.join(directory, 'websitevideo.mp4');
  const frameEarly = path.join(directory, 'early.png');
  const frameLate = path.join(directory, 'late.png');
  const server = http.createServer(async (req, res) => {
    if (req.url === '/fixture') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(testHomepage());
    }
    if (req.url === '/video.mp4') {
      const data = await fsp.readFile(outputPath);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': data.length });
      return res.end(data);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><video id="player" controls preload="auto" src="/video.mp4"></video>');
  });
  const port = await listen(server);
  try {
    const rendered = await renderCompanyWebsiteVideo({
      websiteUrl: `http://127.0.0.1:${port}/fixture`,
      outputPath,
      allowUnsafeTestUrl: true,
    });
    assert.equal(rendered.outputPath, outputPath);
    const probe = await probeVideo(outputPath);
    assert.equal(probe.stream.codec_name, 'h264');
    assert.equal(probe.stream.width, 1280);
    assert.equal(probe.stream.height, 720);
    assert.equal(probe.stream.pix_fmt, 'yuv420p');
    assert.ok(probe.duration >= 19.8 && probe.duration <= 20.2);

    await runProcess(ffmpegPath, ['-y', '-ss', '3', '-i', outputPath, '-frames:v', '1', frameEarly]);
    await runProcess(ffmpegPath, ['-y', '-ss', '16', '-i', outputPath, '-frames:v', '1', frameLate]);
    const websiteMovement = await pixelDifference(frameEarly, frameLate, { left: 380, top: 80, width: 800, height: 560 });
    const fixedOverlay = await pixelDifference(frameEarly, frameLate, { left: 35, top: 35, width: 250, height: 120 });
    assert.ok(websiteMovement > 18, `websitebeeld bewoog onvoldoende (${websiteMovement})`);
    assert.ok(fixedOverlay < 2.5, `videovak verschoof of veranderde (${fixedOverlay})`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/player`);
    await page.locator('#player').evaluate((video) => video.play());
    await page.waitForFunction(() => document.querySelector('#player').currentTime > 0.25);
    assert.equal(await page.locator('#player').evaluate((video) => video.videoWidth), 1280);
    await browser.close();
    if (process.env.WEBSITE_VIDEO_E2E_KEEP_OUTPUT === '1') {
      const artifactDirectory = path.resolve(__dirname, '../../output/company-website-video-e2e');
      await fsp.mkdir(artifactDirectory, { recursive: true });
      await Promise.all([
        fsp.copyFile(outputPath, path.join(artifactDirectory, 'websitevideo.mp4')),
        fsp.copyFile(frameEarly, path.join(artifactDirectory, 'frame-early.png')),
        fsp.copyFile(frameLate, path.join(artifactDirectory, 'frame-late.png')),
      ]);
    }
  } finally {
    await close(server);
    await fsp.rm(directory, { recursive: true, force: true });
  }
});
