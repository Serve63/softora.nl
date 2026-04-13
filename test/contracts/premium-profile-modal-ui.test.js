const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium profielmodal heeft een werkende annuleerknop en subtielere stijl', () => {
  const jsPath = path.join(__dirname, '../../assets/personnel-theme.js');
  const cssPath = path.join(__dirname, '../../assets/personnel-theme.css');
  const jsSource = fs.readFileSync(jsPath, 'utf8');
  const cssSource = fs.readFileSync(cssPath, 'utf8');

  assert.match(
    jsSource,
    /premiumProfileModalRef\.cancelBtn\.addEventListener\("click", function \(\) \{\s*closePremiumProfileModal\(\);\s*\}\);/s
  );
  assert.match(
    cssSource,
    /\.premium-profile-dialog\s*\{[\s\S]*width:\s*min\(500px,\s*100%\);[\s\S]*border-radius:\s*24px;[\s\S]*box-shadow:\s*0 18px 52px rgba\(12,\s*14,\s*26,\s*0\.16\);/s
  );
  assert.doesNotMatch(jsSource, /Werk je naam en profielfoto bij voor de premium omgeving\./);
  assert.match(
    cssSource,
    /\.premium-profile-title\s*\{[\s\S]*font-size:\s*clamp\(1\.26rem,\s*2\.4vw,\s*1\.62rem\);[\s\S]*max-width:\s*none;[\s\S]*white-space:\s*nowrap;/s
  );
  assert.match(
    cssSource,
    /\.premium-profile-primary-btn,\s*\.premium-profile-secondary-btn\s*\{[\s\S]*min-height:\s*40px;[\s\S]*border-radius:\s*999px;/s
  );
  assert.match(jsSource, /let premiumSidebarProfileResolved = !isPremiumPersonnelContext;/);
  assert.match(jsSource, /function markPremiumSidebarProfileResolved\(\) \{/);
  assert.match(jsSource, /if \(!premiumSidebarProfileResolved\) return;/);
  assert.match(jsSource, /paintSidebarAvatar\(avatarEl, resolvedSession\);\s*markPremiumSidebarProfileResolved\(\);/s);
  assert.match(jsSource, /if \(!triggerEl\) \{\s*markPremiumSidebarProfileResolved\(\);\s*return;\s*\}/s);
  assert.match(
    cssSource,
    /:root\[data-personnel-loading="true"\] \[data-sidebar-profile-trigger\] \{[\s\S]*opacity:\s*0 !important;[\s\S]*pointer-events:\s*none !important;/s
  );
});
