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
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)/g)) assert.ok(fs.existsSync(path.join(root,match[1])),match[1]);
});
test('desktop chooser allocates space to all sections without clipping overflow', () => {
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 assert.match(css,/grid-template-rows:204px minmax\(300px,2fr\) minmax\(130px,1fr\)/);
 assert.match(css,/\.toekomst-ai \.intro\{padding:112px 0 16px/);
 assert.match(css,/height:100svh;min-height:640px/);
 assert.doesNotMatch(css,/\.toekomst-ai (?:body|\.page)\{[^}]*overflow:hidden/);
});
test('SEO login stays separate from the landing page and unavailable until accounts are connected', () => {
 const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 assert.ok(config.rewrites.some(r=>r.source==='/seo-login' && r.destination==='/assets/seo-login/index.html'));
 const entry=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.match(entry,/href="\/seo-login"/);
 assert.match(entry,/<a class="choice" data-service="\/seo-solution"/);
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
 const processCss=fs.readFileSync(path.join(root,'assets/website-showcase/style-3.css'),'utf8');
 const stepSize=processCss.match(/\.Werkwijze_name__UsuC7\{[^}]*font-size:clamp\(([^,]+),[^,]+,([\d.]+)rem\)/);
 assert.ok(stepSize && Number.parseFloat(stepSize[1]) >= 1.125 && Number(stepSize[2]) <= 2.2,'Process labels stay readable on mobile and smaller than the section headings');
 const headerContact=html.match(/<a href="\/contact" class="btn btn-primary Nav_cta__gBZXl">[^]*?<\/a>/)?.[0] || '';
 assert.match(headerContact,/<span class="btn-label">CONTACT<\/span>/);
 const preview=fs.readFileSync(path.join(root,'assets/website-showcase/preview.js'),'utf8');
 assert.doesNotMatch(preview,/\$\$\('[^']*Nav_cta__gBZXl/,'Header contact link must navigate without opening the redesign dialog');
 for(const file of ['index.html','preview.js','work.js']) {
  const content=fs.readFileSync(path.join(root,'assets/website-showcase',file),'utf8');
  assert.doesNotMatch(content,/kreatives|31613066250|13 06 62 50/i,'Showcase must not present the source agency as Softora');
 }
 assert.match(html,/href="mailto:info@softora\.nl"/);
 assert.match(html,/href="tel:\+31643262792"/);
 for(const m of html.matchAll(/(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g)){
  if(/^(https?:|data:|tel:|mailto:|\/)/.test(m[1])) continue;
  assert.ok(fs.existsSync(path.join(root,'assets/website-showcase',m[1])),m[1]);
 }
});

test('desktop banners retain equal grid tracks within a bounded chooser', () => {
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 assert.match(css,/max-height:800px;margin:0 0 auto/);
});

test("toekomst names the telephone offer", () => {
 const html=fs.readFileSync(path.join(root,"assets/entry/toekomst.html"),"utf8");
 assert.match(html,/<h2>AI-TELEFONIST<\/h2>/);
});

test('toekomst uses SEO Solution consistently', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.match(html,/<h2>SEO SOLUTION<\/h2>/);
 assert.match(html,/<strong>SEO Solution<\/strong>/);
 assert.doesNotMatch(html,/SEO-tool/i);
});

test('final chooser labels and direct product destinations stay intact', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.match(html,/<a class="choice" href="\/nieuwe-website"/);
 assert.match(html,/<a class="choice" href="\/chatbot"/);
 assert.match(html,/<a class="choice" href="\/bedrijfssoftware"/);
 for(const route of ['seo-solution','voicesoftware']) assert.match(html,new RegExp('<a class="choice" data-service="/'+route+'"'));
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

test('toekomst removes the upcoming AI banner and restores tall desktop cards', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.doesNotMatch(html,/ai-feature|AI-IMPLEMENTATIE|AI die meewerkt|BINNENKORT|ai-medewerker-box/);
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 assert.match(css,/grid-template-rows:204px minmax\(300px,2fr\) minmax\(130px,1fr\)/);
});

test('toekomst service cards omit the numbered badges', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.doesNotMatch(html,/class="choice-number"/);
 assert.equal((html.match(/class="choice"/g)||[]).length,5);
});

test('toekomst mobile header and intro stay compact', () => {
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 assert.match(css,/@media\(max-width:760px\)\{\.toekomst-ai \.intro\{padding-top:20px\}\}/);
 assert.doesNotMatch(css,/\.toekomst-ai \.intro\{padding-top:100px\}/);
 const mobile=css.slice(css.indexOf('/* Mobile chooser:'));
 assert.match(mobile,/^\/\*[^]*?@media\(max-width:760px\)\{/);
 assert.match(mobile,/\.toekomst-ai \.login-menu\{display:none\}/);
 assert.match(mobile,/\.toekomst-ai \.contact-menu \.contact\{min-height:36px;min-width:94px;/);
 assert.match(mobile,/\.toekomst-ai \.contact-menu \.contact-chevron\{width:22px;height:22px\}/);
});

test('toekomst mobile features the first website card and shortens the meeting banner', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 const mobile=css.slice(css.indexOf('/* Mobile chooser:'));
 const choices=Array.from(html.matchAll(/<a class="choice" (?:href|data-service)="([^"]+)"/g),m=>m[1]);
 assert.deepEqual(choices,['/nieuwe-website','/bedrijfssoftware','/chatbot','/voicesoftware','/seo-solution']);
 assert.match(mobile,/\.toekomst-ai \.choice:last-child\{grid-column:auto;height:285px\}/);
 assert.match(mobile,/\.toekomst-ai \.choice\[href="\/nieuwe-website"\]\{grid-column:1\/-1;height:200px\}/);
 assert.match(mobile,/\.toekomst-ai \.meet-softora\{height:200px;min-height:0;/);
 assert.match(html,/ai-medewerker\.css\?v=juridisch-footer-20261003/);
});

test('toekomst footer uses a quiet centered article link with a direct blog destination', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 const footer=html.match(/<footer>[^]*?<\/footer>/)?.[0] || '';
 assert.match(footer,/<a class="articles-link" href="https:\/\/www\.softora\.nl\/blog"><span>Bekijk onze artikelen<\/span><\/a>/);
 assert.doesNotMatch(footer,/Artikelen lezen|↗|<svg/);
 assert.match(css,/\.toekomst-ai footer\{display:grid;grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\);/);
 assert.match(css,/@media\(max-width:760px\)\{\s*\.toekomst-ai footer\{grid-template-columns:minmax\(0,1fr\);justify-items:center;/);
 assert.match(css,/\.toekomst-ai \.articles-link\{grid-row:1\}/);
 assert.match(css,/\.toekomst-ai \.footer-copyright\{grid-row:2;justify-self:center;min-height:44px\}/);
 assert.match(footer,/<a class="footer-personnel" href="\/premium-personeel-login"><span>Personeel<\/span><\/a>/);
 assert.match(css,/\.toekomst-ai \.articles-link,\.toekomst-ai \.footer-personnel\{[^}]*min-height:32px;[^}]*font-size:11px;[^}]*letter-spacing:0;line-height:1\.5;/);
 assert.ok(fs.existsSync(path.join(root,'premium-personeel-login.html')));
 assert.match(css,/\.toekomst-ai \.footer-personnel\{display:none\}/);
});

test('toekomst login menu uses lightweight transparent figures for both destinations', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 const menu=html.match(/<div class="login-options contact-options"[^]*?<p class="login-status"/)?.[0] || '';
 assert.doesNotMatch(menu,/<svg/);
 for(const destination of ['seo','chatbot']) {
  const option=menu.match(new RegExp('<a class="contact-option login-option" href="/'+destination+'-login">([^]*?)</a>'))?.[1] || '';
  assert.match(option,new RegExp('src="/assets/entry/'+destination+'-login-mascot-v1.webp" alt=""'));
  const asset=fs.readFileSync(path.join(root,'assets/entry',destination+'-login-mascot-v1.webp'));
  assert.equal(asset.toString('ascii',8,12),'WEBP');
  assert.equal(asset.toString('ascii',12,16),'VP8X');
  assert.ok(asset[20] & 0x10,'Login figure must preserve transparency');
  assert.ok(asset.length<20000,'Login figure should stay below 20 KB');
 }
});

test('toekomst contact links use transparent 3D images and keep their destinations', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 const menu=html.match(/<nav class="contact-options" aria-label="Contactmogelijkheden">[^]*?<\/nav>/)?.[0] || '';
 for(const [name,href] of [['form','https://www.softora.nl/contact'],['whatsapp','https://wa.me/31643262792'],['phone','tel:+31643262792']]) {
  const option=menu.match(new RegExp('<a href="'+href.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"[^]*?</a>'))?.[0] || '';
  assert.ok(option,'Contact destination must remain available: '+href);
  assert.match(option,new RegExp('class="contact-option-icon contact-avatar" aria-hidden="true"><img src="/assets/entry/contact-'+name+'-icon-v1.webp" alt=""'));
  const asset=fs.readFileSync(path.join(root,'assets/entry','contact-'+name+'-icon-v1.webp'));
  assert.equal(asset.toString('ascii',8,12),'WEBP');
  assert.equal(asset.toString('ascii',12,16),'VP8X');
  assert.ok(asset[20]&0x10,'Contact icon must preserve transparency');
  assert.ok(asset.length<20000,'Contact icon should stay below 20 KB');
 }
});

test('toekomst reduces only the SEO login image within the shared icon column', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 const css=fs.readFileSync(path.join(root,'assets/entry/ai-medewerker.css'),'utf8');
 const seo=html.match(/<a class="contact-option login-option" href="\/seo-login">[^]*?<\/a>/)?.[0] || '';
 const chatbot=html.match(/<a class="contact-option login-option" href="\/chatbot-login">[^]*?<\/a>/)?.[0] || '';
 assert.match(seo,/login-avatar--seo/);
 assert.doesNotMatch(chatbot,/login-avatar--seo/);
 assert.match(css,/\.login-avatar--seo img\{width:85%;height:85%\}/);
});

test('chooser marks only telephone and SEO as upcoming and enables available services', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 const cards=[...html.matchAll(/<a class="choice" (?:href|data-service)="([^"]+)"[^]*?<\/a>/g)];
 assert.equal(cards.length,5);
 for(const [card,href] of cards){
  if(['/voicesoftware','/seo-solution'].includes(href)) {
   assert.match(card,/aria-label="[^"]*Coming soon"/);
   assert.match(card,/<span class="choice-coming-soon" aria-hidden="true">Coming soon<\/span>/);
  } else {
   assert.doesNotMatch(card,/Coming soon|choice-coming-soon|aria-disabled|tabindex/);
   assert.ok(card.includes('href="'+href+'"'));
  }
 }
});

test('meeting banner is available and links to Softora contact', () => {
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 const banner=html.match(/<section class="meet-softora"[^]*?<\/section>/)?.[0] || '';
 assert.doesNotMatch(banner,/Coming soon|choice-coming-soon|aria-disabled|tabindex/);
 assert.match(banner,/class="meet-link" href="https:\/\/www\.softora\.nl\/contact"/);
});

test('only coming soon cards cannot navigate or enter keyboard tab order', () => {
 const {parseDocument,DomUtils}=require('htmlparser2');
 const doc=parseDocument(fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8'));
 const disabled=DomUtils.findAll(n=>n.attribs?.['aria-disabled']==='true',doc.children);
 assert.equal(disabled.length,2);
 assert.deepEqual(disabled.map(n=>n.attribs['data-service']),['/voicesoftware','/seo-solution']);
 for(const node of disabled){
  assert.equal(node.attribs.href,undefined);
  assert.equal(node.attribs.tabindex,'-1');
  assert.equal(node.attribs.onclick,undefined);
 }
 const active=DomUtils.findAll(n=>n.attribs?.class==='choice' && n.attribs.href,doc.children);
 assert.deepEqual(active.map(n=>n.attribs.href),['/nieuwe-website','/bedrijfssoftware','/chatbot']);
});

test('upcoming cards have a muted appearance without hover navigation cues', () => {
 const css=fs.readFileSync(path.join(root,'assets/entry/coming-soon.css'),'utf8');
 assert.match(css,/\.toekomst-ai \.choice\[aria-disabled="true"\]\{opacity:\.7\}/);
 assert.match(css,/\.toekomst-ai \.choice\[aria-disabled="true"\] \.choice-photo\{filter:grayscale\(1\)\}/);
 assert.match(css,/\.choice:has\(\.choice-coming-soon\) \.arrow\{display:none\}/);
 assert.match(css,/\.choice\[aria-disabled="true"\]:hover\{transform:none;/);
 assert.match(css,/\.choice\[aria-disabled="true"\]:hover \.choice-photo\{transform:none\}/);
 const html=fs.readFileSync(path.join(root,'assets/entry/toekomst.html'),'utf8');
 assert.match(html,/coming-soon\.css\?v=20261006d/);
});
