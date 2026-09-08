const { parseCssColorToRgb } = require('./website-brand-colors');

const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
function describeColor(rgb) {
  const [r, g, b] = rgb;
  const max = Math.max(...rgb), min = Math.min(...rgb), chroma = max - min;
  const hue = !chroma ? 0 : ((max === r ? (g - b) / chroma : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60 + 360) % 360;
  return { rgb, hue, chroma, hex: '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('') };
}
function brandError(message) {
  const error = new Error(message);
  error.status = 422; // No automatic paid regeneration on a brand mismatch.
  error.code = 'WEBDESIGN_BRAND_COLORS';
  return error;
}
async function readColorEvidence(dataUrl, allowPaleShades = false) {
  const match = String(dataUrl || '').match(/^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match || match[1].length > 32 * 1024 * 1024) throw brandError('De huisstijlcontrole kon de afbeelding niet lezen.');
  let raster;
  try {
    raster = await require('sharp')(Buffer.from(match[1], 'base64'), { limitInputPixels: 45_000_000 })
      .rotate().resize({ width: 1000, height: 1800, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (_) {
    throw brandError('De huisstijlcontrole kon de afbeelding niet lezen.');
  }
  const { data, info } = raster;
  if (info.width < 200 || info.height < 200) throw brandError('De afbeelding is te klein voor een betrouwbare huisstijlcontrole.');
  const bins = new Map();
  let total = 0;
  for (let y = 2; y < info.height - 2; y += 2) {
    for (let x = 2; x < info.width - 2; x += 2) {
      total++;
      const i = (y * info.width + x) * 3;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      const color = describeColor(rgb);
      if (color.chroma < (allowPaleShades ? 12 : 22) || color.chroma / Math.max(...rgb) < (allowPaleShades ? 0.06 : 0.2)) continue;
      // Suppress textured photography; retain UI fills, text interiors and gentle gradients.
      if ([1, -1, info.width, -info.width].some(offset => rgb.some((v, c) => Math.abs(v - data[i + offset * 3 + c]) > 10))) continue;
      const key = rgb.map(v => Math.round(v / 8)).join(',');
      const bin = bins.get(key) || { count: 0, sums: [0, 0, 0] };
      bin.count++;
      rgb.forEach((v, c) => { bin.sums[c] += v; });
      bins.set(key, bin);
    }
  }
  return [...bins.values()].map(bin => ({ ...describeColor(bin.sums.map(v => v / bin.count)), share: bin.count / total }));
}
async function prepareWebsitePreviewBrandGuard(scan, references) {
  if (scan.referenceImageMode !== 'homepage-screenshot') return null;
  if (!references[0]) throw brandError('Er is geen homepage-screenshot om de bestaande huiskleuren vast te stellen.');
  const evidence = await readColorEvidence(references[0].dataUrl);
  // Only semantic CSS brand/CTA colors confirmed in the screenshot are machine-enforced.
  // A photo histogram cannot reliably identify a brand. Unknown palettes remain governed
  // by the mandatory screenshot/prompt; never mislabel a photo-heavy brand as monochrome.
  const colors = (scan.brandColorEvidence || []).map(v => parseCssColorToRgb(v.color)).filter(Boolean)
    .map(v => describeColor([v.r, v.g, v.b])).filter(v => v.chroma >= 22);
  const confirmed = colors.map(color => ({ ...color, share: evidence.filter(v => v.rgb.every((c, i) => Math.abs(c - color.rgb[i]) <= 16)).reduce((n, v) => n + v.share, 0) }))
    .filter(v => v.share >= 0.00015).sort((a, b) => b.share - a.share);
  const palette = [];
  // Incidental photo pixels matching an unrelated CSS theme must not become a lock.
  for (const color of confirmed.filter(v => v.share >= (confirmed[0]?.share || 0) * 0.05)) {
    if (!palette.some(v => hueDistance(v.hue, color.hue) <= 24)) palette.push(color);
    if (palette.length === 4) break;
  }
  return { version: 'brand-color-families-v1', palette };
}
async function assertWebsitePreviewBrandColors(guard, dataUrl) {
  if (!guard || !guard.palette.length) return;
  const evidence = await readColorEvidence(dataUrl, true);
  const missing = guard.palette.filter(color => evidence.filter(v => hueDistance(v.hue, color.hue) <= 28)
    .reduce((n, v) => n + v.share, 0) < 0.0003);
  if (missing.length) throw brandError('Het ontwerp is afgekeurd omdat bevestigde huiskleuren ontbreken. Het is niet opgeslagen; er is niet automatisch opnieuw gegenereerd.');
}
module.exports = { prepareWebsitePreviewBrandGuard, assertWebsitePreviewBrandColors };
