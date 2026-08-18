const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  PERSONAL_SITE_ROUTES,
  registerPersonalSiteRoutes,
} = require('../../server/routes/public-pages');

const REPO_ROOT = path.join(__dirname, '../..');
const PERSONAL_SITES_ROOT = path.join(REPO_ROOT, 'personal-sites');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('personal pages are registered under the Softora subpaths', () => {
  assert.deepEqual(Object.keys(PERSONAL_SITE_ROUTES).sort(), ['martijnvandeven', 'servecreusen']);

  Object.keys(PERSONAL_SITE_ROUTES).forEach((slug) => {
    const siteRoot = path.join(PERSONAL_SITES_ROOT, slug);
    const html = fs.readFileSync(path.join(siteRoot, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`https://www\\.softora\\.nl/${slug}/`));
    assert.ok(fs.existsSync(path.join(siteRoot, 'styles.css')));
    assert.ok(fs.existsSync(path.join(siteRoot, 'script.js')));
    assert.ok(fs.existsSync(path.join(siteRoot, 'assets')));
  });

  const vercelConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8'));
  assert.match(vercelConfig.functions['api/index.js'].includeFiles, /personal-sites\/\*\*/);
  assert.match(vercelConfig.functions['api/[...path].js'].includeFiles, /personal-sites\/\*\*/);
});

test('personal page route serves HTML, redirects the slashless path, and serves assets', async () => {
  const app = express();
  registerPersonalSiteRoutes(app, { personalSitesDirectory: PERSONAL_SITES_ROOT });
  const server = await startServer(app);
  const port = server.address().port;

  try {
    const redirect = await fetch(`http://127.0.0.1:${port}/martijnvandeven`, { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/martijnvandeven/');

    const page = await fetch(`http://127.0.0.1:${port}/martijnvandeven/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Martijn van de Ven/);
    assert.match(page.headers.get('cache-control') || '', /max-age=300/);

    const stylesheet = await fetch(`http://127.0.0.1:${port}/servecreusen/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type') || '', /text\/css/);
  } finally {
    await closeServer(server);
  }
});

test('personal page route keeps dotfile protection while serving from a hidden parent directory', async () => {
  const hiddenRoot = fs.mkdtempSync(path.join(os.tmpdir(), '.softora-personal-sites-'));
  const siteRoot = path.join(hiddenRoot, 'martijnvandeven');
  fs.mkdirSync(siteRoot, { recursive: true });
  fs.writeFileSync(path.join(siteRoot, 'index.html'), '<!doctype html><title>Verborgen root werkt</title>');

  const app = express();
  registerPersonalSiteRoutes(app, { personalSitesDirectory: hiddenRoot });
  const server = await startServer(app);
  const port = server.address().port;

  try {
    const page = await fetch(`http://127.0.0.1:${port}/martijnvandeven/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Verborgen root werkt/);
  } finally {
    await closeServer(server);
    fs.rmSync(hiddenRoot, { recursive: true, force: true });
  }
});
