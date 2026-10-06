#!/usr/bin/env node
'use strict';

// Local, read-only design review. This never starts the production app or workers.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getSeoContentItem } = require('../server/services/seo-content');
const { renderOverviewHtml, renderArticleHtml, publishedArticles } = require('../server/services/seo-articles-presentation');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.BLOG_PREVIEW_PORT || 4317);
const now = new Date();
const publicPreviewLinks = new Set([
  '/nieuwe-website', '/bedrijfssoftware', '/voicesoftware', '/chatbot', '/seo-solution',
  '/chatbot-login', '/seo-login', '/premium-personeel-login', '/contact',
]);

const mime = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

function createPreviewServer() {
  return http.createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    let body;
    let contentType = 'text/html; charset=utf-8';
    if (pathname === '/toekomst') {
      body = (await fs.readFile(path.join(root, 'assets/entry/toekomst.html'), 'utf8'))
        .replace('href="https://www.softora.nl/blog"', 'href="/blog"');
    } else if (publicPreviewLinks.has(pathname)) {
      response.writeHead(302, { Location: 'https://www.softora.nl' + pathname, 'Cache-Control': 'no-store' }).end();
      return;
    } else if (pathname === '/kennisbank' || pathname.startsWith('/kennisbank/')) {
      const item = getSeoContentItem('kennisbank', pathname.split('/')[2], { now });
      if (pathname !== '/kennisbank' && !item) { response.writeHead(404).end('Artikel niet gevonden'); return; }
      response.writeHead(302, { Location: item ? '/blog/' + item.slug : '/blog', 'Cache-Control': 'no-store' }).end();
      return;
    } else if (pathname === '/' || pathname === '/blog' || pathname === '/blog-voorstel.html') {
      body = renderOverviewHtml({ now });
    } else if (pathname.startsWith('/blog/')) {
      const item = getSeoContentItem('blog', pathname.split('/')[2], { now });
      if (!item || pathname !== '/blog/' + item.slug) { response.writeHead(404).end('Artikel niet gevonden'); return; }
      body = renderArticleHtml(item, { now });
    } else if (pathname.startsWith('/assets/')) {
      const assetsRoot = path.join(root, 'assets');
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(assetsRoot + path.sep) || !mime[path.extname(file).toLowerCase()]) {
        response.writeHead(404).end(); return;
      }
      body = await fs.readFile(file);
      contentType = mime[path.extname(file).toLowerCase()];
    } else {
      response.writeHead(404).end('Niet beschikbaar in dit lokale blogvoorstel');
      return;
    }
    if (contentType.startsWith('text/html')) body = String(body)
      .replace('<head>', '<head><meta name="robots" content="noindex, nofollow">')
      .replace(/<script src="\/assets\/public-conversion-tracking\.js[^"]*" defer><\/script>/, '')
      .replace(/<!-- ebook-offer:start -->[\s\S]*?<!-- ebook-offer:end -->/, '')
      .replace(/<script src="\/assets\/articles\/ebook\.js[^"]*" defer><\/script>/, '')
      .replace(/<link rel="stylesheet" href="\/assets\/articles\/ebook\.css[^"]*">/, '');
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Lokale preview kon dit bestand niet laden.');
    if (error.code !== 'ENOENT') console.error(error);
  }
  });
}

if (require.main === module) {
  const server = createPreviewServer();
  server.listen(port, '127.0.0.1', () => {
    console.log('Lokaal blogvoorstel: http://127.0.0.1:' + server.address().port + '/blog (' + publishedArticles(now).length + ' bestaande artikelen)');
  });
}

module.exports = { createPreviewServer };
