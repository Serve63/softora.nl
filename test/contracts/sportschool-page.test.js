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
  const scriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek.js'), 'utf8');
  const inputScriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek-input.js'), 'utf8');
  const stateScriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek-state.js'), 'utf8');
  const syncScriptSource = fs.readFileSync(path.join(__dirname, '../../assets/sportschool-logboek-sync.js'), 'utf8');
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
  assert.match(pageSource, /assets\/sportschool-logboek\.css\?v=20260811a/);
  assert.match(pageSource, /assets\/premium-ui-state-client\.js/);
  assert.doesNotMatch(pageSource, /assets\/sportschool-supabase-config\.js/);
  assert.match(pageSource, /assets\/sportschool-logboek\.js/);
  assert.match(pageSource, /assets\/sportschool-logboek-sync\.js\?v=20260724a/);
  assert.match(pageSource, /assets\/sportschool-logboek-state\.js\?v=20260811a/);
  assert.match(pageSource, /assets\/sportschool-logboek-input\.js\?v=20260811a/);
  assert.match(pageSource, /assets\/sportschool-logboek\.js\?v=20260811b/);
  assert.doesNotMatch(pageSource, /assets\/sportschool-program-migration\.js/);
  assert.match(pageSource, /data-day-trigger/);
  assert.match(pageSource, /data-add-exercise/);
  assert.match(pageSource, /data-exercise-list/);
  assert.doesNotMatch(pageSource, /<script>[\s\S]*<\/script>/i);
  assert.match(stylesSource, /font-family: Oswald/);
  assert.match(stylesSource, /html\s*\{[\s\S]*?overflow: hidden;/);
  assert.match(stylesSource, /body\s*\{[\s\S]*?height: 100dvh;[\s\S]*?overflow: hidden;/);
  assert.match(stylesSource, /\.gym-app\s*\{[\s\S]*?height: 100dvh;[\s\S]*?overflow: hidden;/);
  assert.doesNotMatch(stylesSource, /\.gym-logo/);
  assert.match(stylesSource, /\.delete-action/);
  assert.match(stylesSource, /\.drag-handle/);
  assert.match(stylesSource, /\.exercise-swipe\.is-reordering/);
  assert.match(stylesSource, /\.day-picker-backdrop/);
  assert.match(scriptSource, /sportschool_logboek/);
  assert.match(scriptSource, /REMOTE_LOGBOOK_ENDPOINT = '\/api\/sportschool-logboek'/);
  assert.doesNotMatch(scriptSource, /softora_sportschool_logbook/);
  assert.doesNotMatch(scriptSource, /SoftoraSportschoolSupabase/);
  assert.doesNotMatch(scriptSource, /\/rest\/v1\//);
  assert.doesNotMatch(scriptSource, /getDirectSupabaseConfig/);
  assert.match(scriptSource, /SoftoraUiStateClient/);
  assert.match(scriptSource, /fetch\(REMOTE_LOGBOOK_ENDPOINT/);
  assert.match(scriptSource, /snapshot: JSON\.parse\(snapshotJson\)/);
  assert.match(scriptSource, /scheduleRemoteSave/);
  assert.match(scriptSource, /persistRemoteSave/);
  assert.match(scriptSource, /remoteSaveInFlight/);
  assert.match(scriptSource, /pendingRemoteSave/);
  assert.match(scriptSource, /stateRevision/);
  assert.match(scriptSource, /lastSavedRevision/);
  assert.match(scriptSource, /scheduleRemoteRetry/);
  assert.match(scriptSource, /allowConcurrent/);
  assert.match(scriptSource, /exerciseSources/);
  assert.match(scriptSource, /exerciseKeyForTitle/);
  assert.match(scriptSource, /readCanonicalExerciseSource/);
  assert.match(scriptSource, /setExerciseCompleted/);
  assert.match(scriptSource, /completedDates/);
  assert.match(scriptSource, /aria-pressed/);
  assert.match(scriptSource, /exercise-complete/);
  assert.match(scriptSource, /focusout/);
  assert.match(scriptSource, /SoftoraSportschoolLogbookInput/);
  assert.match(inputScriptSource, /captureActiveExerciseInput/);
  assert.match(inputScriptSource, /restoreActiveExerciseInput/);
  assert.match(inputScriptSource, /selectionStart/);
  assert.match(stateScriptSource, /mergeExerciseSource/);
  assert.match(stateScriptSource, /reconcileExerciseSources/);
  assert.match(stateScriptSource, /normalizeCompletionDates/);
  assert.match(stateScriptSource, /isCompletedOnDate/);
  assert.match(stateScriptSource, /setCompletedOnDate/);
  assert.match(scriptSource, /if \(isApplyingRemoteState \|\| !isReady\) return;/);
  assert.match(scriptSource, /window\.setTimeout\(boot, REMOTE_RETRY_DELAY_MS\)/);
  assert.match(scriptSource, /keepalive: options\.keepalive === true/);
  assert.match(scriptSource, /pagehide/);
  assert.match(syncScriptSource, /visibilitychange/);
  assert.match(scriptSource, /createResumeRevalidator/);
  assert.match(scriptSource, /bindResumeEvents/);
  assert.match(scriptSource, /baseUpdatedAt/);
  assert.match(scriptSource, /resolveRemoteSaveConflict/);
  assert.match(syncScriptSource, /mergeConflictSnapshots/);
  assert.match(syncScriptSource, /refreshDeferredForLocalChanges/);
  assert.match(scriptSource, /lastRemoteSnapshotJson = snapshotJson/);
  assert.match(scriptSource, /createDefaultState/);
  assert.match(scriptSource, /async function boot/);
  assert.match(scriptSource, /await loadRemoteState\(\)/);
  assert.doesNotMatch(scriptSource, /render\(\);\s*loadRemoteState\(\);/);
  assert.match(scriptSource, /dayChoiceTitle/);
  assert.match(scriptSource, /day\.id === currentWeekday\(\) \? 'Vandaag' : day\.title/);
  assert.doesNotMatch(scriptSource, /\{\s*id:\s*'today'/);
  assert.match(scriptSource, /DEFAULT_DAY_EXERCISES/);
  assert.match(scriptSource, /Chest Press/);
  assert.match(scriptSource, /Leg Extensions/);
  assert.match(scriptSource, /title: 'Leg Extensions', notes: '', sets: '3', reps: '8', kg: '100'/);
  assert.doesNotMatch(scriptSource, /title: 'Leg Extensions'[\s\S]*?kg: '100\/104'/);
  assert.match(scriptSource, /Hammer Curls/);
  assert.match(scriptSource, /Abdominal Machine/);
  assert.match(scriptSource, /LEGACY_NOTE_TEXTS/);
  assert.match(scriptSource, /cleanNotes/);
  assert.match(scriptSource, /markLegacyNotes/);
  assert.match(scriptSource, /friday:\s*\[\]/);
  assert.doesNotMatch(scriptSource, /localStorage/);
  assert.match(scriptSource, /setPointerCapture/);
  assert.match(scriptSource, /pointerdown/);
  assert.match(scriptSource, /bindReorder/);
  assert.match(scriptSource, /targetIndexForPointer/);
  assert.match(scriptSource, /saveOrders\(day, nextOrders, \{ silent: true \}\)/);
  assert.match(scriptSource, /wrap\.className = `metric metric-\$\{field\}`/);
  assert.match(scriptSource, /input\.enterKeyHint = 'next'/);
  assert.match(scriptSource, /input\.inputMode = inputMode/);
  assert.match(scriptSource, /event\.target\.closest\?\.\('input, textarea, button/);
  assert.doesNotMatch(scriptSource, /title\.addEventListener\('input', \(\) => \{\s*title\.value = upper/);
  assert.match(scriptSource, /notes\.placeholder = ''/);
  assert.doesNotMatch(scriptSource, /notes\.placeholder = 'NOTITIES'/);
  assert.match(scriptSource, /Verwijder/);
  assert.match(scriptSource, /IS EEN RUSTDAG/);
  assert.match(stylesSource, /\.exercise-card\s*\{[\s\S]*?padding: 8px 10px;/);
  assert.match(stylesSource, /\.exercise-list\s*\{[\s\S]*?gap: 6px;/);
  assert.match(stylesSource, /\.metric\s*\{[\s\S]*?width: 44px;[\s\S]*?min-height: 44px;/);
  assert.match(stylesSource, /\.metric-kg\s*\{[\s\S]*?width: 54px;/);
  assert.match(stylesSource, /\.metric-input\s*\{[\s\S]*?width: 100%;[\s\S]*?height: 27px;[\s\S]*?padding: 0;/);
  assert.match(stylesSource, /\.exercise-complete\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?touch-action: manipulation;/);
  assert.match(stylesSource, /\.exercise-card\.is-complete\s*\{[\s\S]*?background: linear-gradient/);
  assert.match(stylesSource, /\.exercise-title\s*\{[\s\S]*?font-size: 13px;/);
  assert.match(stylesSource, /\.exercise-notes\s*\{[\s\S]*?font-size: 11px;/);
  assert.match(stylesSource, /:focus-within/);
  assert.doesNotMatch(stylesSource, /\.day-trigger::after/);

});
