const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const root = __dirname;
const port = Number(process.env.PERSONAL_SITES_PORT || 4188);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === '/servecreusen') pathname = '/servecreusen/';
  if (pathname === '/martijnvandeven') pathname = '/martijnvandeven/';
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== path.join(root, 'index.html')) {
    response.writeHead(403).end('Niet toegestaan');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Niet gevonden');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Persoonlijke sites: http://127.0.0.1:${port}/`);
  console.log(`Servé: http://127.0.0.1:${port}/servecreusen/`);
  console.log(`Martijn: http://127.0.0.1:${port}/martijnvandeven/`);
});
