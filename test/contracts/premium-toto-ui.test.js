const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Ruben zet toto is ontgrendeld als persistent paper forward lab', () => {
  const pageSource = read('premium-instellingen.html');
  const settingsSource = read('assets/premium-user-management.js');
  const totoSource = read('assets/premium-toto.js');
  const totoCss = read('assets/premium-toto.css');

  assert.match(pageSource, /<!-- SOFTORA_PAGE_STATE_BOOTSTRAP -->/);
  assert.match(pageSource, /assets\/premium-toto\.css\?v=20260726a/);
  assert.match(pageSource, /assets\/premium-ui-state-client\.js\?v=20260722b/);
  assert.match(pageSource, /assets\/premium-toto-math\.js\?v=20260726a/);
  assert.match(pageSource, /assets\/premium-toto\.js\?v=20260726a/);

  assert.match(settingsSource, /var isToto = label === 'Ruben zet toto';/);
  assert.match(settingsSource, /isWinning \|\| isDatabase \|\| isHealth \|\| isOmzetwerk \|\| isToto/);
  assert.match(settingsSource, /window\.SoftoraToto\.open\(\)/);
  assert.match(settingsSource, /Simulatie actief/);
  assert.match(settingsSource, /Paper-bankroll, forward voorspellingen, modelkalibratie en harde risicorails/);

  assert.match(totoSource, /REMOTE_SCOPE = 'premium_toto_lab'/);
  assert.match(totoSource, /REMOTE_KEY = 'softora_premium_toto_lab_v1'/);
  assert.match(totoSource, /source: 'premium-toto'/);
  assert.match(totoSource, /result\.source[\s\S]*!== 'supabase'/);
  assert.match(totoSource, /Opslag is niet door de database bevestigd/);
  assert.match(totoSource, /Simulatie · geen echte inzetten/);
  assert.match(totoSource, /2,56% samengestelde groei per dag/);
  assert.match(totoSource, /Append-only forward log/);
  assert.match(totoSource, /computeCohorts\(state, 'market'\)/);
  assert.match(totoSource, /data-toto-settlement-modal/);
  assert.match(totoSource, /document\.body\.classList\.add\('toto-lab-active'\)/);
  assert.match(totoSource, /document\.body\.classList\.remove\('toto-lab-active'\)/);
  assert.doesNotMatch(totoSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(totoSource, /toto\.nl|sportsbook|\/api\/bet|placeBet/i);

  assert.match(totoCss, /#screen-toto/);
  assert.match(totoCss, /\.toto-main-grid/);
  assert.match(totoCss, /body\.toto-lab-active \.sidebar[\s\S]*display:\s*none !important/);
  assert.match(totoCss, /body\.toto-lab-active main\.main[\s\S]*width:\s*100% !important/);
  assert.match(totoCss, /@media \(max-width: 720px\)/);
});

test('TOTO-logboek blijft paper-only en heeft harde evidence- en risicorails', () => {
  const mathSource = read('assets/premium-toto-math.js');

  assert.match(mathSource, /maxStakePct: 2/);
  assert.match(mathSource, /maxDailyRiskPct: 5/);
  assert.match(mathSource, /maxOpenRiskPct: 8/);
  assert.match(mathSource, /minEdgePoints: 3/);
  assert.match(mathSource, /minExpectedValuePct: 2/);
  assert.match(mathSource, /evidenceTarget: 200/);
  assert.match(mathSource, /Combi’s en bet builders vallen buiten deze bewijsrails/);
  assert.match(mathSource, /Deze paper-voorspelling staat al in het forward log/);
  assert.doesNotMatch(mathSource, /\.skip|\.only|todo/i);
});
