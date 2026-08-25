const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createKnownPrettyPageSlugToFile, resolveLegacyPrettyPageRedirect } = require('../../server/config/page-routing');

function readPngDimensions(filePath) {
  const source = fs.readFileSync(filePath);
  assert.equal(source.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return {
    width: source.readUInt32BE(16),
    height: source.readUInt32BE(20),
  };
}

test('sportschool logboek page is available as installable pretty page', () => {
  const pagePath = path.join(__dirname, '../../sportschool.html');
  const logoPath = path.join(__dirname, '../../assets/sportschool-logboek-logo.png');
  const icon192Path = path.join(__dirname, '../../assets/sportschool-logboek-icon-192.png');
  const touchIconPath = path.join(__dirname, '../../assets/sportschool-logboek-touch-icon.png');
  const manifestPath = path.join(__dirname, '../../assets/sportschool-logboek.webmanifest');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const stylesSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek.css'), 'utf8');
  const bootstrapScriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek-bootstrap.js'), 'utf8');
  const scriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek.js'), 'utf8');
  const inputScriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek-input.js'), 'utf8');
  const stateScriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek-state.js'), 'utf8');
  const gestureScriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek-gesture.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const prettyPages = createKnownPrettyPageSlugToFile(new Set(['sportschool.html']));

  assert.equal(prettyPages.get('logboek'), 'sportschool.html');
  assert.equal(resolveLegacyPrettyPageRedirect('sportschool'), 'logboek');
  assert.equal(fs.existsSync(logoPath), true);
  assert.deepEqual(readPngDimensions(logoPath), { width: 512, height: 512 });
  assert.deepEqual(readPngDimensions(icon192Path), { width: 192, height: 192 });
  assert.deepEqual(readPngDimensions(touchIconPath), { width: 180, height: 180 });
  assert.equal(manifest.start_url, '/logboek');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(
    manifest.icons.map((icon) => `${icon.src}:${icon.sizes}:${icon.purpose}`),
    [
      '/assets/sportschool-logboek-icon-192.png?v=20260629b:192x192:any',
      '/assets/sportschool-logboek-logo.png?v=20260629b:512x512:any maskable',
    ]
  );
  assert.match(pageSource, /<title>Servé's Logboek<\/title>/);
  assert.match(pageSource, /apple-mobile-web-app-capable/);
  assert.match(pageSource, /apple-mobile-web-app-title" content="Servé's logboek"/);
  assert.match(pageSource, /noindex,nofollow/);
  assert.match(pageSource, /<link rel="manifest" href="\/assets\/sportschool-logboek\.webmanifest\?v=20260629b">/);
  assert.match(pageSource, /<link rel="icon" type="image\/png" href="\/assets\/sportschool-logboek-icon-192\.png\?v=20260629b" sizes="192x192">/);
  assert.match(pageSource, /<link rel="apple-touch-icon" sizes="180x180" href="\/assets\/sportschool-logboek-touch-icon\.png\?v=20260629b">/);
  assert.doesNotMatch(pageSource, /<img class="gym-logo"/);
  assert.match(pageSource, /assets\/sportschool-logboek\.css/);
  assert.match(pageSource, /assets\/sportschool-logboek\.css\?v=20260825a/);
  assert.match(pageSource, /assets\/sportschool-logboek-bootstrap\.js\?v=20260819b/);
  assert.match(bootstrapScriptSource, /remoteBootstrapVersion/);
  assert.match(bootstrapScriptSource, /mergeRemoteSnapshot/);
  assert.match(bootstrapScriptSource, /localDay\.orders\.length > 0/);
  assert.doesNotMatch(pageSource, /assets\/premium-ui-state-client\.js/);
  assert.doesNotMatch(pageSource, /sportschool-logboek-sync\.js/);
  assert.doesNotMatch(pageSource, /assets\/sportschool-supabase-config\.js/);
  assert.match(pageSource, /assets\/sportschool-logboek\.js/);
  assert.match(pageSource, /assets\/sportschool-logboek-state\.js\?v=20260821a/);
  assert.match(pageSource, /assets\/sportschool-logboek-input\.js\?v=20260811a/);
  assert.match(pageSource, /assets\/sportschool-logboek-gesture\.js\?v=20260814a/);
  assert.match(pageSource, /assets\/sportschool-logboek\.js\?v=20260825a/);
  assert.doesNotMatch(pageSource, /assets\/sportschool-program-migration\.js/);
  assert.match(pageSource, /data-day-trigger/);
  assert.match(pageSource, /data-add-exercise/);
  assert.match(pageSource, /data-exercise-list/);
  assert.match(pageSource, /data-logbook-status/);
  assert.doesNotMatch(pageSource, /<script>[\s\S]*<\/script>/i);
  assert.match(stylesSource, /font-family: Oswald/);
  assert.match(stylesSource, /html\s*\{[\s\S]*?overflow-y: auto;[\s\S]*?-webkit-overflow-scrolling: touch;/);
  assert.match(stylesSource, /body\s*\{[\s\S]*?min-height: 100dvh;[\s\S]*?overflow: visible;[\s\S]*?touch-action: pan-y;/);
  assert.match(stylesSource, /\.gym-app\s*\{[\s\S]*?min-height: 100dvh;[\s\S]*?overflow: visible;[\s\S]*?touch-action: pan-y;/);
  assert.doesNotMatch(stylesSource, /\.gym-logo/);
  assert.match(stylesSource, /\.delete-action/);
  assert.match(stylesSource, /\.drag-handle/);
  assert.match(stylesSource, /\.exercise-swipe\.is-reordering/);
  assert.match(stylesSource, /\.day-picker-backdrop/);
  assert.match(scriptSource, /sportschool_logboek/);
  assert.match(scriptSource, /LOCAL_STORAGE_KEY = 'softora_sportschool_logboek_v1'/);
  assert.doesNotMatch(scriptSource, /softora_sportschool_logbook/);
  assert.doesNotMatch(scriptSource, /SoftoraSportschoolSupabase/);
  assert.doesNotMatch(scriptSource, /\/rest\/v1\//);
  assert.doesNotMatch(scriptSource, /getDirectSupabaseConfig/);
  assert.doesNotMatch(scriptSource, /SoftoraUiStateClient/);
  assert.doesNotMatch(scriptSource, /\/api\/sportschool-logboek['"]/);
  assert.match(scriptSource, /PUBLIC_BOOTSTRAP_URL = '\/api\/sportschool-logboek-public'/);
  assert.match(scriptSource, /SoftoraSportschoolLogbookBootstrap/);
  assert.match(scriptSource, /readRemoteSnapshotValue\(payload\?\.values\)/);
  assert.match(bootstrapScriptSource, /REMOTE_STORAGE_KEY = 'sportschool_logboek_v1'/);
  assert.match(bootstrapScriptSource, /LOCAL_STORAGE_KEY = 'softora_sportschool_logboek_v1'/);
  assert.match(scriptSource, /remoteBootstrapVersion/);
  assert.match(scriptSource, /snapshotHasExercisesForDay/);
  assert.match(scriptSource, /mergeRemoteSnapshot\(remoteSnapshot, localSnapshot\)/);
  assert.match(scriptSource, /scheduleLocalSave/);
  assert.match(scriptSource, /persistLocalState/);
  assert.match(scriptSource, /normalizeFormHistory/);
  assert.match(scriptSource, /setFormHistory/);
  assert.match(scriptSource, /formHistory/);
  assert.match(scriptSource, /form-status-button/);
  assert.match(scriptSource, /nextFormStatus\(button\.dataset\.status\)/);
  assert.doesNotMatch(scriptSource, /form-status-select|createElement\('select'\)/);
  assert.match(scriptSource, /stateRevision/);
  assert.match(scriptSource, /lastSavedRevision/);
  assert.match(scriptSource, /exerciseSources/);
  assert.match(scriptSource, /exerciseKeyForTitle/);
  assert.match(scriptSource, /readCanonicalExerciseSource/);
  assert.match(scriptSource, /setExerciseCompleted/);
  assert.match(scriptSource, /completedDates/);
  assert.doesNotMatch(scriptSource, /completeButton|exercise-complete|aria-pressed/);
  assert.match(scriptSource, /SoftoraSportschoolLogbookGesture/);
  assert.match(scriptSource, /resolveSwipeEnd/);
  assert.match(gestureScriptSource, /classifySwipeIntent/);
  assert.match(gestureScriptSource, /toggle-complete/);
  assert.match(scriptSource, /SoftoraSportschoolLogbookInput/);
  assert.match(inputScriptSource, /captureActiveExerciseInput/);
  assert.match(inputScriptSource, /restoreActiveExerciseInput/);
  assert.match(inputScriptSource, /selectionStart/);
  assert.match(stateScriptSource, /mergeExerciseSource/);
  assert.match(stateScriptSource, /reconcileExerciseSources/);
  assert.match(stateScriptSource, /normalizeCompletionDates/);
  assert.match(stateScriptSource, /isCompletedOnDate/);
  assert.match(stateScriptSource, /setCompletedOnDate/);
  assert.match(scriptSource, /if \(isApplyingStoredState \|\| !isReady\) return;/);
  assert.match(scriptSource, /pagehide/);
  assert.match(scriptSource, /createDefaultState/);
  assert.match(scriptSource, /function boot/);
  assert.match(scriptSource, /loadLocalState\(\)/);
  assert.match(scriptSource, /loadRemoteState\(localState\.snapshot\)/);
  assert.match(scriptSource, /cache: 'no-store'/);
  assert.doesNotMatch(scriptSource, /render\(\);\s*loadLocalState\(\);/);
  assert.match(scriptSource, /dayChoiceTitle/);
  assert.match(scriptSource, /day\.id === currentWeekday\(\) \? 'Vandaag' : day\.title/);
  assert.doesNotMatch(scriptSource, /\{\s*id:\s*'today'/);
  assert.match(scriptSource, /DEFAULT_DAY_EXERCISES/);
  assert.match(
    scriptSource,
    /DEFAULT_DAY_EXERCISES = \{\s*monday: \[\],\s*tuesday: \[\],\s*wednesday: \[\],\s*thursday: \[\],\s*friday: \[\],\s*saturday: \[\],\s*sunday: \[\],\s*\}/
  );
  assert.doesNotMatch(scriptSource, /Chest Press|Leg Extensions|Hammer Curls|Abdominal Machine/);
  assert.match(scriptSource, /LEGACY_NOTE_TEXTS/);
  assert.match(scriptSource, /cleanNotes/);
  assert.match(scriptSource, /markLegacyNotes/);
  assert.match(scriptSource, /friday:\s*\[\]/);
  assert.match(scriptSource, /localStorage/);
  assert.match(scriptSource, /setPointerCapture/);
  assert.match(scriptSource, /pointerdown/);
  assert.match(scriptSource, /bindReorder/);
  assert.match(scriptSource, /targetIndexForPointer/);
  assert.match(scriptSource, /saveOrders\(day, nextOrders, \{ silent: true \}\)/);
  assert.match(scriptSource, /wrap\.className = `metric metric-\$\{field\}`/);
  assert.match(scriptSource, /input\.enterKeyHint = 'next'/);
  assert.match(scriptSource, /input\.inputMode = inputMode/);
  assert.match(scriptSource, /targetInput = event\.target\.closest\?\.\('input, textarea, select/);
  assert.doesNotMatch(scriptSource, /if \(event\.target\.closest\?\.\('input, textarea, button[\s\S]*?\)\) return;/);
  assert.doesNotMatch(scriptSource, /title\.addEventListener\('input', \(\) => \{\s*title\.value = upper/);
  assert.match(scriptSource, /notes\.placeholder = ''/);
  assert.doesNotMatch(scriptSource, /notes\.placeholder = 'NOTITIES'/);
  assert.match(scriptSource, /Verwijder/);
  assert.match(scriptSource, /IS EEN RUSTDAG/);
  assert.match(stylesSource, /\.exercise-card\s*\{[\s\S]*?padding: 8px 10px;/);
  assert.match(stylesSource, /\.exercise-list\s*\{[\s\S]*?gap: 6px;/);
  assert.match(stylesSource, /\.metric\s*\{[\s\S]*?width: 36px;[\s\S]*?min-height: 36px;/);
  assert.match(stylesSource, /\.metric-kg\s*\{[\s\S]*?width: 46px;/);
  assert.match(stylesSource, /\.metric-input\s*\{[\s\S]*?width: 100%;[\s\S]*?height: 22px;[\s\S]*?padding: 0;/);
  assert.match(stylesSource, /\.form-history\s*\{/);
  assert.match(stylesSource, /\.exercise-top\s*\{[\s\S]*?grid-template-rows: 38px minmax\(34px, auto\);[\s\S]*?row-gap: 2px;/);
  assert.match(stylesSource, /\.exercise-controls\s*\{[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 1 \/ span 2;[\s\S]*?align-self: start;[\s\S]*?justify-items: end;/);
  assert.match(stylesSource, /\.form-status:nth-child\(3\)\s*\{[\s\S]*?width: 46px;/);
  assert.doesNotMatch(scriptSource, /title\.textContent = 'Vorm'/);
  assert.doesNotMatch(scriptSource, /form-status-index/);
  assert.match(stylesSource, /\.form-status-button\[data-status="up"\]/);
  assert.match(stylesSource, /\.form-status-button\[data-status="down"\]/);
  assert.match(stylesSource, /\.form-status-button\[data-status="same"\]/);
  assert.doesNotMatch(stylesSource, /\.exercise-complete/);
  assert.match(stylesSource, /\.completion-action\s*\{[\s\S]*?background: #3d945c;[\s\S]*?pointer-events: none;/);
  assert.match(stylesSource, /\.exercise-card\.is-complete\s*\{[\s\S]*?background: linear-gradient/);
  assert.match(stylesSource, /\.exercise-title\s*\{[\s\S]*?font-size: 13px;/);
  assert.match(scriptSource, /top\.append\(dragHandle, title, controls, notes\);/);
  assert.match(scriptSource, /card\.append\(top\);/);
  assert.doesNotMatch(scriptSource, /card\.append\(top, notes\);/);
  assert.match(scriptSource, /notes = document\.createElement\('textarea'\);/);
  assert.match(scriptSource, /notes\.rows = 1;/);
  assert.match(scriptSource, /notes\.setAttribute\('aria-label', `Notities \$\{exercise\.title\}`\);/);
  assert.match(scriptSource, /function fitNotesField\(field\)[\s\S]*?field\.style\.height = 'auto';[\s\S]*?field\.scrollHeight/);
  assert.match(scriptSource, /list\.querySelectorAll\('\.exercise-notes'\)\.forEach\(fitNotesField\);/);
  assert.doesNotMatch(scriptSource, /notes\.type = 'text';/);
  assert.match(stylesSource, /\.exercise-notes\s*\{[\s\S]*?grid-column: 1 \/ span 2;[\s\S]*?grid-row: 2;[\s\S]*?overflow: hidden;[\s\S]*?resize: none;[\s\S]*?font-size: 10px;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: pre-wrap;/);
  assert.match(stylesSource, /:focus-within/);
  assert.doesNotMatch(stylesSource, /\.day-trigger::after/);

});

test('voltooide oefening dekt swipe-acties volledig af en toont verwijderen alleen bewust', () => {
  const stylesSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek.css'), 'utf8');

  assert.match(stylesSource, /\.exercise-card\s*\{[\s\S]*?z-index:\s*1;/);
  assert.match(stylesSource, /\.exercise-card\.is-complete\s*\{[\s\S]*?background:\s*linear-gradient\(105deg, #e2f8e9, #f8fffa\);/);
  assert.doesNotMatch(stylesSource, /background:\s*linear-gradient\(105deg,\s*rgba\(/);
  assert.match(stylesSource, /\.delete-action\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/);
  assert.match(stylesSource, /\.exercise-swipe\[data-swipe-intent="delete"\] \.delete-action,[\s\S]*?\.exercise-swipe\[data-open="true"\] \.delete-action\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/);
  assert.match(stylesSource, /\.completion-action\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/);
  assert.match(stylesSource, /\.exercise-swipe\[data-swipe-intent="complete"\] \.completion-action\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?visibility:\s*visible;/);
});
