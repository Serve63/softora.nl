const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
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

function normalizeString(value) {
  return String(value || '').trim();
}

function resolveExecutable(explicitPath, bundledPath, fallbackName) {
  return normalizeString(explicitPath) || normalizeString(bundledPath) || fallbackName;
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`${path.basename(executable)} stopte met code ${code}: ${stderr.slice(-1600)}`);
      error.exitCode = code;
      return reject(error);
    });
  });
}

function buildFfmpegArgs(rawVideoPath, overlayPath, outputPath, options = {}) {
  const duration = Number(options.durationSeconds) || VIDEO_DURATION_SECONDS;
  const startOffsetSeconds = Math.max(0, Number(options.startOffsetSeconds) || 0);
  return [
    '-y',
    ...(startOffsetSeconds > 0 ? ['-ss', startOffsetSeconds.toFixed(3)] : []),
    '-i', rawVideoPath,
    '-loop', '1', '-i', overlayPath,
    '-filter_complex',
    `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},fps=30,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS[site];[1:v]format=rgba[card];[site][card]overlay=20:20:shortest=1[outv]`,
    '-map', '[outv]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-t', String(duration),
    '-movflags', '+faststart',
    outputPath,
  ];
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

async function performSmoothScroll(page, durationMs = VIDEO_DURATION_SECONDS * 1000) {
  await page.evaluate(async ({ duration }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const viewportHeight = window.innerHeight || 720;
    const fullHeight = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    const available = Math.max(0, fullHeight - viewportHeight);
    const target = Math.min(available, Math.max(viewportHeight * 2.8, available * 0.72));
    const startPause = 2000;
    const endPause = 1300;
    const pauseOne = target > 120 ? 950 : 0;
    const pauseTwo = target > viewportHeight * 1.4 ? 850 : 0;
    const movingDuration = Math.max(1000, duration - startPause - endPause - pauseOne - pauseTwo);
    const segments = pauseTwo ? 3 : pauseOne ? 2 : 1;
    const segmentDuration = movingDuration / segments;
    const ease = (value) => value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
    const animate = (from, to, ms) => new Promise((resolve) => {
      const started = performance.now();
      const frame = (now) => {
        const progress = Math.min(1, (now - started) / ms);
        window.scrollTo(0, Math.min(available, from + ((to - from) * ease(progress))));
        if (progress < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    window.scrollTo(0, 0);
    await wait(startPause);
    if (target > 1) {
      const points = Array.from({ length: segments }, (_, index) => target * ((index + 1) / segments));
      let from = 0;
      for (let index = 0; index < points.length; index += 1) {
        await animate(from, points[index], segmentDuration);
        from = points[index];
        if (index === 0 && pauseOne) await wait(pauseOne);
        if (index === 1 && pauseTwo) await wait(pauseTwo);
      }
    } else {
      await wait(movingDuration + pauseOne + pauseTwo);
    }
    await wait(endPause);
  }, { duration: durationMs });
}

async function captureHomepage(options) {
  const temporaryDirectory = options.temporaryDirectory;
  const browserType = options.browserType || chromium;
  const validatedUrl = options.allowUnsafeTestUrl
    ? options.websiteUrl
    : await validatePublicWebsiteUrl(options.websiteUrl, { lookup: options.lookup });
  const browser = await browserType.launch({ headless: true, executablePath: options.chromiumPath || undefined });
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      screen: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      recordVideo: { dir: temporaryDirectory, size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const recordingStartedAtMs = Date.now();
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
    const scrollStartedAtMs = Date.now();
    await performSmoothScroll(page, (options.durationSeconds || VIDEO_DURATION_SECONDS) * 1000);
    const video = page.video();
    await context.close();
    context = null;
    if (!video) throw new Error('Playwright heeft geen ruwe video gemaakt.');
    const rawVideoPath = await video.path();
    await fsp.access(rawVideoPath, fs.constants.R_OK);
    return {
      rawVideoPath,
      finalUrl: page.url(),
      startOffsetSeconds: Math.max(0, (scrollStartedAtMs - recordingStartedAtMs) / 1000),
    };
  } finally {
    if (context) await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function probeVideo(filePath, options = {}) {
  const ffprobePath = resolveExecutable(options.ffprobePath || process.env.FFPROBE_PATH, bundledFfprobePath, 'ffprobe');
  const { stdout } = await runProcess(ffprobePath, [
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
  try {
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await createOverlayPng(overlayPath);
    const capture = await captureHomepage({ ...options, temporaryDirectory });
    const ffmpegPath = resolveExecutable(options.ffmpegPath || process.env.FFMPEG_PATH, bundledFfmpegPath, 'ffmpeg');
    await runProcess(ffmpegPath, buildFfmpegArgs(capture.rawVideoPath, overlayPath, outputPath, {
      ...options,
      startOffsetSeconds: capture.startOffsetSeconds,
    }));
    const probe = await probeVideo(outputPath, options);
    await fsp.rm(capture.rawVideoPath, { force: true });
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
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  buildFfmpegArgs,
  captureHomepage,
  createOverlayPng,
  performSmoothScroll,
  probeVideo,
  renderCompanyWebsiteVideo,
  runProcess,
};
