const PHOTO_SCOPE = 'premium_database_photos';
const PHOTO_KEY = 'softora_database_photos_v1';

function normalizeString(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeParseObject(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function clampChunkCount(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function isValidImageSource(value) {
  const source = normalizeString(value);
  return /^https?:\/\//i.test(source) || /^data:image\//i.test(source);
}

function readChunkedDataUrl(values, photoKey, chunkCount) {
  const key = normalizeString(photoKey);
  if (!key) return '';
  const stateValues = values && typeof values === 'object' ? values : {};
  const count = clampChunkCount(chunkCount);
  const chunks = [];
  if (count) {
    for (let index = 0; index < count; index += 1) chunks.push(normalizeString(stateValues[`${key}_${index}`]));
  } else {
    for (let index = 0; index < 100; index += 1) {
      const chunk = stateValues[`${key}_${index}`];
      if (typeof chunk !== 'string') break;
      chunks.push(normalizeString(chunk));
    }
  }
  const dataUrl = chunks.join('');
  return /^data:image\//i.test(dataUrl) ? dataUrl : '';
}

function findPhotoRecord(photoMap, customerId) {
  const id = normalizeString(customerId);
  if (!id) return null;
  const direct = photoMap && photoMap[id];
  if (direct && typeof direct === 'object') return { ...direct, id: normalizeString(direct.id) || id };
  return Object.keys(photoMap || {}).reduce((match, key) => {
    if (match) return match;
    const item = photoMap[key];
    if (!item || typeof item !== 'object') return null;
    return normalizeString(item.id || key) === id ? { ...item, id } : null;
  }, null);
}

function resolvePreviewSource(values, record, type) {
  if (!record || typeof record !== 'object') return '';
  if (type === 'mockup') {
    const direct = normalizeString(
      record.websiteMockup ||
        record.mockup ||
        record.websiteMockupUrl ||
        record.mockupUrl ||
        record.signedMockupUrl ||
        (record.mockupStorage && record.mockupStorage.signedUrl)
    );
    if (isValidImageSource(direct)) return direct;
    return readChunkedDataUrl(values, record.mockupPhotoKey || record.websiteMockupKey, record.mockupChunkCount || record.websiteMockupChunkCount);
  }
  const direct = normalizeString(
    record.websitePhoto ||
      record.dataUrl ||
      record.websitePhotoUrl ||
      record.signedUrl ||
      record.publicUrl ||
      (record.storage && record.storage.signedUrl)
  );
  if (isValidImageSource(direct)) return direct;
  return readChunkedDataUrl(values, record.photoKey, record.chunkCount);
}

function buildPreviewHtml(preview) {
  const photoSource = escapeHtml(preview.photoSource);
  const mockupSource = escapeHtml(preview.mockupSource);
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Webdesign preview | Softora</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100%;background:#161616;color:#fff;font-family:Inter,Arial,sans-serif}
    main{min-height:100vh;display:grid;place-items:center;padding:clamp(12px,2vw,28px)}
    .preview-grid{width:min(1800px,100%);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:clamp(10px,1.3vw,18px);align-items:start}
    .preview-frame{min-width:0;display:flex;align-items:flex-start;justify-content:center}
    img{display:block;width:100%;height:auto;max-height:94vh;object-fit:contain;background:#fff}
    @media(max-width:820px){main{place-items:start center}.preview-grid{grid-template-columns:1fr}img{max-height:none}}
  </style>
</head>
<body>
  <main>
    <div class="preview-grid" aria-label="Webdesign en device mockup naast elkaar">
      <div class="preview-frame"><img src="${photoSource}" alt="Webdesign"></div>
      <div class="preview-frame"><img src="${mockupSource}" alt="Device mockup"></div>
    </div>
  </main>
</body>
</html>`;
}

function buildNotFoundHtml() {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Preview niet gevonden | Softora</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161616;color:#fff;font-family:Inter,Arial,sans-serif}
    p{max-width:520px;margin:0;padding:24px;text-align:center;line-height:1.5}
  </style>
</head>
<body><p>Deze preview is niet beschikbaar.</p></body>
</html>`;
}

function createPublicWebdesignPreviewService(options = {}) {
  const getUiStateValues = typeof options.getUiStateValues === 'function' ? options.getUiStateValues : async () => ({ values: {} });

  async function resolvePreview(customerId) {
    const id = normalizeString(customerId);
    if (!/^[a-z0-9_-]{3,160}$/i.test(id)) return null;
    const state = await getUiStateValues(PHOTO_SCOPE);
    const values = state && state.values && typeof state.values === 'object' ? state.values : {};
    const photoMap = safeParseObject(values[PHOTO_KEY]);
    const record = findPhotoRecord(photoMap, id);
    const photoSource = resolvePreviewSource(values, record, 'photo');
    const mockupSource = resolvePreviewSource(values, record, 'mockup');
    if (!isValidImageSource(photoSource) || !isValidImageSource(mockupSource)) return null;
    return { id, photoSource, mockupSource };
  }

  async function getPreviewPageResponse(req, res) {
    const preview = await resolvePreview(req && req.params && req.params.customerId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!preview) return res.status(404).send(buildNotFoundHtml());
    return res.status(200).send(buildPreviewHtml(preview));
  }

  return {
    getPreviewPageResponse,
    resolvePreview,
  };
}

module.exports = {
  PHOTO_KEY,
  PHOTO_SCOPE,
  createPublicWebdesignPreviewService,
};
