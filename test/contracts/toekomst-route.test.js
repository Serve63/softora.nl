const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
test('toekomst route serves the chooser with production links and available assets', () => {
 const config = JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 assert.ok(config.rewrites.some(r=>r.source==='/toekomst' && r.destination==='/assets/entry/toekomst.html'));
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.doesNotMatch(html,/127\.0\.0\.1|localhost|kreatives-preview|innovaware-preview/);
 assert.match(html,/href="\/chatbot-login"/);
 assert.match(html,/<section class="ai-feature" aria-label="AI-medewerker — Binnenkort"/);
 assert.match(html,/AI-MEDEWERKER/);
 assert.match(html,/src="\/assets\/entry\/ai-medewerker-box.webp"/);
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)/g)) assert.ok(fs.existsSync(path.join(root,match[1])),match[1]);
});
test('desktop chooser allocates space to all sections without clipping overflow', () => {
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 assert.match(css,/grid-template-rows:72px minmax\(170px,1fr\) minmax\(155px,1fr\) 100px/);
 assert.match(css,/height:100svh;min-height:640px/);
 assert.doesNotMatch(css,/\.toekomst-ai (?:body|\.page)\{[^}]*overflow:hidden/);
});
test('SEO login is linked and explicitly unavailable until accounts are connected', () => {
 const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 assert.ok(config.rewrites.some(r=>r.source==='/seo-login' && r.destination==='/assets/seo-login/index.html'));
 const entry=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.match(entry,/href="\/seo-login"/);
 const login=fs.readFileSync(path.join(root,'assets/seo-login/index.html'),'utf8');
 assert.match(login,/SEO-accountkoppeling is binnenkort beschikbaar/);
 assert.match(login,/type="password"[^>]*disabled/);
 assert.doesNotMatch(login,/type="submit"/);
});
test('new website choice links the published local design with Softora contact targets', () => {
 const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 assert.ok(config.rewrites.some(r=>r.source==='/nieuwe-website' && r.destination==='/assets/website-showcase/index.html'));
 const entry=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.match(entry,/href="\/nieuwe-website"/);
 const html=fs.readFileSync(path.join(root,'assets/website-showcase/index.html'),'utf8');
 assert.match(html,/<base href="\/assets\/website-showcase\/">/);
 assert.doesNotMatch(html,/https:\/\/www\.kreatives\.nl/);
 for(const m of html.matchAll(/(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g)){
  if(/^(https?:|data:|tel:|mailto:|\/)/.test(m[1])) continue;
  assert.ok(fs.existsSync(path.join(root,'assets/website-showcase',m[1])),m[1]);
 }
});
