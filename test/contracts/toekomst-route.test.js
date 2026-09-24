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
 assert.match(html,/<section class="ai-feature" aria-label="AI-implementatie in je bedrijf — Binnenkort"/);
 assert.match(html,/AI-IMPLEMENTATIE/);
 assert.match(html,/src="\/assets\/entry\/ai-medewerker-box.webp"/);
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)/g)) assert.ok(fs.existsSync(path.join(root,match[1])),match[1]);
});
test('desktop chooser allocates space to all sections without clipping overflow', () => {
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 assert.match(css,/grid-template-rows:120px minmax\(130px,1fr\) minmax\(155px,1fr\) minmax\(130px,1fr\)/);
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

test('desktop banners retain equal grid tracks within a bounded chooser', () => {
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 assert.match(css,/max-height:800px;margin:0 0 auto/);
});

test("toekomst names the telephone and implementation offers", () => {
 const html=fs.readFileSync(path.join(root,"assets/entry/toekomst.html"),"utf8");
 assert.match(html,/<h2>AI-TELEFONIST<\/h2>/);
 assert.match(html,/AI-IMPLEMENTATIE/);
});

test('toekomst uses SEO Solution consistently', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.match(html,/<h2>SEO SOLUTION<\/h2>/);
 assert.match(html,/<strong>SEO Solution<\/strong>/);
 assert.doesNotMatch(html,/SEO-tool/i);
});

test('final chooser labels and direct product destinations stay intact', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 for(const route of ['nieuwe-website','seo-login','chatbot-login','voicesoftware']) assert.match(html,new RegExp('<a class="choice" href="/'+route+'"'));
 assert.match(html,/<h2>AI-IMPLEMENTATIE IN JE BEDRIJF<span>\.<\/span><\/h2>/);
 assert.doesNotMatch(html,/<a[^>]*class="ai-feature"/);
 for(const file of ['assets/entry/toekomst.html','assets/seo-login/index.html']) {
  const content=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(content,/SEO (System|Manager)|SEO-tool/i);
  assert.match(content,/SEO Solution/i);
 }
});

test('toekomst uses its matching office photos without changing shared page imagery', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 assert.match(html,/src="\/assets\/entry\/ai-telefonist-office.webp"/);
 assert.match(css,/\.toekomst-ai \.meet-softora\{background-image:[^}]*meet-softora-office\.webp/);
 for(const file of ['ai-telefonist-office.webp','meet-softora-office.webp']) {
  const image=fs.readFileSync(path.join(root,'assets/entry',file));
  assert.equal(image.toString('ascii',8,12),'WEBP');
  assert.ok(image.length < 400000,'WebP should remain below 400 KB');
 }
});

test('AI implementation uses a wide desktop composition and preserves the mobile artwork', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.match(html,/<source media="\(min-width:761px\)" srcset="\/assets\/entry\/ai-medewerker-box-wide.webp">/);
 assert.match(html,/<img class="ai-feature-image" src="\/assets\/entry\/ai-medewerker-box.webp"/);
 const image=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker-box-wide.webp'));
 assert.equal(image.toString('ascii',8,12),'WEBP');
 assert.ok(image.length < 400000);
});

test('toekomst service cards omit the numbered badges', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.doesNotMatch(html,/class="choice-number"/);
 assert.equal((html.match(/class="choice"/g)||[]).length,5);
});
