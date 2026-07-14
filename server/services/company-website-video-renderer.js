const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { chromium } = require('playwright');
const bundledFfmpegPath = require('ffmpeg-static');
const bundledFfprobePath = require('ffprobe-static').path;
const {
  createSafeNavigationGuard,
  validatePublicWebsiteUrl,
} = require('../security/company-website-video-url');

const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;
const VIDEO_DURATION_SECONDS = 20;
const VIDEO_FPS = 30;

function normalizeString(value) {
  return String(value || '').trim();
}

function runBundledProcess(executable, args) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      shell: false,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });
      const processError = new Error(`${path.basename(executable)} stopte met code ${error.code}: ${String(stderr || '').slice(-1600)}`);
      processError.exitCode = error.code;
      return reject(processError);
    });
  });
}

function runFfmpeg(args) {
  return runBundledProcess(bundledFfmpegPath, args);
}

function runFfprobe(args) {
  return runBundledProcess(bundledFfprobePath, args);
}

function buildFfmpegArgs(framePattern, overlayPath, outputPath, options = {}) {
  const duration = Number(options.durationSeconds) || VIDEO_DURATION_SECONDS;
  return [
    '-y',
    '-framerate', String(VIDEO_FPS),
    '-start_number', '0',
    '-i', framePattern,
    '-loop', '1', '-i', overlayPath,
    '-filter_complex',
    `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1,trim=duration=${duration},setpts=PTS-STARTPTS[site];[1:v]format=rgba[card];[site][card]overlay=20:20:shortest=1[outv]`,
    '-map', '[outv]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-r', String(VIDEO_FPS),
    '-t', String(duration),
    '-movflags', '+faststart',
    outputPath,
  ];
}

function easeInOut(value) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded < 0.5
    ? 2 * bounded * bounded
    : 1 - (Math.pow(-2 * bounded + 2, 2) / 2);
}

function calculateScrollFrame(
  frameIndex,
  totalFrames,
  availableHeight,
  viewportHeight = VIDEO_HEIGHT,
  durationSeconds = VIDEO_DURATION_SECONDS
) {
  const available = Math.max(0, Number(availableHeight) || 0);
  if (available < 1 || totalFrames < 2) return 0;
  const target = Math.min(
    available,
    Math.max(viewportHeight * 2.8, Math.min(available * 0.76, viewportHeight * 6.5))
  );
  const seconds = (Math.max(0, frameIndex) / Math.max(1, totalFrames - 1)) * durationSeconds;
  const segments = [
    { start: 0.8, end: 6.7, from: 0, to: 0.34 },
    { start: 7.0, end: 12.9, from: 0.34, to: 0.68 },
    { start: 13.2, end: 19.3, from: 0.68, to: 1 },
  ];
  if (seconds < segments[0].start) return 0;
  for (const segment of segments) {
    if (seconds <= segment.end) {
      const progress = (seconds - segment.start) / (segment.end - segment.start);
      return Math.min(available, target * (segment.from + ((segment.to - segment.from) * easeInOut(progress))));
    }
    const nextIndex = segments.indexOf(segment) + 1;
    const next = segments[nextIndex];
    if (next && seconds < next.start) return Math.min(available, target * segment.to);
  }
  return Math.min(available, target);
}

function buildOverlaySvg() {
  return Buffer.from(`
    <svg width="324" height="193" viewBox="0 0 324 193" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="150%" height="160%">
          <feDropShadow dx="4" dy="7" stdDeviation="7" flood-color="#000000" flood-opacity="0.38"/>
        </filter>
      </defs>
      <rect x="0" y="0" width="300" height="169" rx="16" fill="#292b31" stroke="#ffffff" stroke-opacity="0.2" filter="url(#shadow)"/>
      <text x="150" y="85" dominant-baseline="middle" text-anchor="middle" fill="#f7f7f8" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="600">Jouw video komt hier</text>
    </svg>
  `);
}

async function createOverlayPng(outputPath) {
  await sharp(buildOverlaySvg()).png().toFile(outputPath);
  return outputPath;
}

async function dismissObstructions(page) {
  const labels = [
    /alles accepteren/i,
    /accepteer alles/i,
    /accept all/i,
    /akkoord/i,
    /toestaan/i,
    /allow all/i,
    /alleen noodzakelijk/i,
    /reject all/i,
    /weigeren/i,
    /sluiten/i,
    /^close$/i,
  ];
  for (const label of labels) {
    try {
      const button = page.getByRole('button', { name: label }).first();
      if (await button.isVisible({ timeout: 150 })) await button.click({ timeout: 500 });
    } catch (_error) {
      // Een onbekende overlay mag de render niet laten mislukken.
    }
  }
  await page.addStyleTag({ content: `
    [class*="chat-widget" i], [id*="chat-widget" i], [class*="intercom" i],
    [id*="intercom" i], iframe[title*="chat" i], [class*="cursor" i],
    [class*="newsletter" i][style*="fixed" i] { display: none !important; }
  `}).catch(() => undefined);
}

async function captureHomepage(options) {
  const temporaryDirectory = options.temporaryDirectory;
  const framesDirectory = path.join(temporaryDirectory, 'frames');
  const framePattern = path.join(framesDirectory, 'frame-%06d.jpg');
  const browserType = options.browserType || chromium;
  const validatedUrl = options.allowUnsafeTestUrl
    ? options.websiteUrl
    : await validatePublicWebsiteUrl(options.websiteUrl, { lookup: options.lookup });
  const browser = await browserType.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      screen: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    if (!options.allowUnsafeTestUrl) {
      await page.route('**/*', createSafeNavigationGuard({
        maxRedirects: options.maxRedirects || 5,
        validate: (url) => validatePublicWebsiteUrl(url, { lookup: options.lookup }),
      }));
    }
    await page.goto(validatedUrl, { waitUntil: 'domcontentloaded', timeout: options.loadTimeoutMs || 30_000 });
    await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => undefined);
    await page.waitForTimeout(1200);
    await dismissObstructions(page);
    await fsp.mkdir(framesDirectory, { recursive: true });
    const durationSeconds = Number(options.durationSeconds) || VIDEO_DURATION_SECONDS;
    const totalFrames = Math.round(durationSeconds * VIDEO_FPS);
    const availableHeight = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const fullHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      );
      return Math.max(0, fullHeight - (window.innerHeight || 720));
    });
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const scrollTop = calculateScrollFrame(
        frameIndex,
        totalFrames,
        availableHeight,
        VIDEO_HEIGHT,
        durationSeconds
      );
      await page.evaluate((top) => window.scrollTo(0, top), scrollTop);
      await page.screenshot({
        path: path.join(framesDirectory, `frame-${String(frameIndex).padStart(6, '0')}.jpg`),
        type: 'jpeg',
        quality: 82,
        animations: 'disabled',
      });
    }
    const finalUrl = page.url();
    await context.close();
    context = null;
    await fsp.access(path.join(framesDirectory, 'frame-000000.jpg'), fs.constants.R_OK);
    await fsp.access(path.join(framesDirectory, `frame-${String(totalFrames - 1).padStart(6, '0')}.jpg`), fs.constants.R_OK);
    return {
      framePattern,
      finalUrl,
      totalFrames,
    };
  } finally {
    if (context) await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function probeVideo(filePath) {
  const { stdout } = await runFfprobe([
    '-v', 'error',
    '-show_entries', 'format=duration,format_name:stream=codec_name,width,height,pix_fmt,codec_type',
    '-of', 'json',
    filePath,
  ]);
  const result = JSON.parse(stdout || '{}');
  const stream = (result.streams || []).find((entry) => entry.codec_type === 'video');
  const duration = Number(result.format && result.format.duration);
  const valid = Boolean(
    stream &&
    stream.codec_name === 'h264' &&
    stream.width === VIDEO_WIDTH &&
    stream.height === VIDEO_HEIGHT &&
    stream.pix_fmt === 'yuv420p' &&
    duration >= 18 &&
    duration <= 22 &&
    /mp4/.test(normalizeString(result.format && result.format.format_name))
  );
  if (!valid) throw new Error('De MP4 heeft niet het vereiste H.264/1280x720/yuv420p/20s-formaat.');
  return { duration, stream, format: result.format };
}

async function renderCompanyWebsiteVideo(options = {}) {
  const outputPath = path.resolve(options.outputPath);
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'softora-website-video-'));
  const overlayPath = path.join(temporaryDirectory, 'overlay.png');
  const renderedPath = path.join(temporaryDirectory, 'websitevideo.mp4');
  try {
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await createOverlayPng(overlayPath);
    const capture = await captureHomepage({ ...options, temporaryDirectory });
    await runFfmpeg(buildFfmpegArgs(capture.framePattern, overlayPath, renderedPath, options));
    const probe = await probeVideo(renderedPath);
    await fsp.copyFile(renderedPath, outputPath);
    return { outputPath, finalUrl: capture.finalUrl, probe };
  } catch (error) {
    await fsp.rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

module.exports = {
  VIDEO_DURATION_SECONDS,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  buildFfmpegArgs,
  calculateScrollFrame,
  captureHomepage,
  createOverlayPng,
  probeVideo,
  renderCompanyWebsiteVideo,
};
