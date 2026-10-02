#!/usr/bin/env node
'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const routes = {
  '/': '/assets/entry/toekomst.html',
  '/toekomst': '/assets/entry/toekomst.html',
  '/seo-solution': '/assets/seo-solution/index.html',
  '/seo-login': '/assets/seo-login/index.html',
  '/chatbot': '/assets/chatbot-landing/index.html',
  '/chatbot-login': '/assets/chatbot-login/index.html',
  '/voicesoftware': '/assets/voicesoftware/index.html',
  '/bedrijfssoftware': '/bedrijfssoftware.html',
};
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
function createPreviewServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const target = routes[pathname] || pathname;
      const file = path.resolve(root, '.' + target);
      const isBusinessLanding = pathname === '/bedrijfssoftware' && file === path.join(root, 'bedrijfssoftware.html');
      if (!isBusinessLanding && (!target.startsWith('/assets/') || target.split('/').some((part) => part.startsWith('.')) || !file.startsWith(path.join(root, 'assets') + path.sep))) throw new Error('Unavailable preview path');
      const type = contentTypes[path.extname(file).toLowerCase()];
      if (!type) throw new Error('Unavailable preview type');
      const contents = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': contents.length });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Niet gevonden');
    }
  });
}
if (require.main === module) {
  const port = Number(process.env.SEO_PREVIEW_PORT || 4176);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Ongeldige SEO_PREVIEW_PORT');
  const server = createPreviewServer();
  server.listen(port, '127.0.0.1', () => console.log(`SEO preview: http://127.0.0.1:${server.address().port}/seo-solution`));
}
module.exports = { createPreviewServer };
