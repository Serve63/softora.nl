const { spawn } = require('child_process');
const { setTimeout: delay } = require('timers/promises');

function randomPort() {
  const blockedFetchPorts = new Set([4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697]);
  let port = 0;
  do {
    port = 5100 + Math.floor(Math.random() * 3900);
  } while (blockedFetchPorts.has(port));
  return port;
}

async function waitFor(url, timeoutMs = 25000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return true;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }
  throw lastError || new Error(`Server kwam niet op tijd omhoog: ${url}`);
}

async function startTestServer() {
  const port = randomPort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk || '');
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk || '');
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(`${baseUrl}/healthz`);

  return {
    baseUrl,
    child,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(3000).then(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }),
      ]);
    },
    getOutput() {
      return output;
    },
  };
}

module.exports = {
  startTestServer,
};
