const normalizeString = (value) => String(value || '').trim();

// WordPress ships this whole palette on every page, regardless of the actual brand.
const presetNames = 'black|white|cyan-bluish-gray|pale-pink|vivid-red|luminous-vivid-orange|luminous-vivid-amber|light-green-cyan|vivid-green-cyan|pale-cyan-blue|vivid-cyan-blue|vivid-purple';
function removeFrameworkPresets(css) {
  return String(css || '')
    .replace(new RegExp(`--wp--preset--color--(?:${presetNames})\\s*:[^;}{]+;?`, 'gi'), '')
    .replace(/--wp--preset--gradient--[a-z0-9-]+\s*:[^;}{]+;?/gi, '')
    .replace(new RegExp(`\\.has-(?:${presetNames})-(?:color|background-color|border-color)[^{]*\\{[^}]*\\}`, 'gi'), '')
    .replace(/--(?:swiper-theme-color|wp-admin-theme-color[a-z0-9-]*)\s*:[^;}{]+;?/gi, '');
}

function extractColorTokensFromCss(textRaw) {
  const text = String(textRaw || '');
  if (!text) return [];
  const matches = text.match(/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi);
  if (!Array.isArray(matches)) return [];
  return matches
    .map((value) => normalizeString(value).toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
}

function parseCssColorToRgb(colorRaw) {
  const color = normalizeString(colorRaw || '').toLowerCase();
  if (!color) return null;

  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const value = hex[1];
    if (value.length === 3 || value.length === 4) {
      const r = Number.parseInt(value[0] + value[0], 16);
      const g = Number.parseInt(value[1] + value[1], 16);
      const b = Number.parseInt(value[2] + value[2], 16);
      if (value.length === 4 && value[3] === '0') return null;
      return { r, g, b };
    }
    if (value.length === 8 && value.slice(6) === '00') return null;
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return { r, g, b };
  }

  const functional = color.match(/^(rgba?|hsla?)\(([^)]*)\)$/i);
  if (functional) {
    const parts = functional[2].trim().split(/\s*[,/]\s*|\s+/);
    const values = parts.map(Number.parseFloat);
    if (values.length < 3 || values.some(v => !Number.isFinite(v))) return null;
    if (parts[3] && values[3] <= 0) return null;
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    if (functional[1].startsWith('rgb')) {
      const [r, g, b] = parts.slice(0, 3).map((v, i) => clamp(values[i] * (v.endsWith('%') ? 2.55 : 1), 255));
      return { r, g, b };
    }
    if (!parts[1].endsWith('%') || !parts[2].endsWith('%')) return null;
    const hueScale = parts[0].endsWith('turn') ? 360 : parts[0].endsWith('grad') ? 0.9 : parts[0].endsWith('rad') ? 180 / Math.PI : 1;
    const h = ((values[0] * hueScale % 360) + 360) % 360 / 30;
    const saturation = clamp(values[1], 100) / 100, lightness = clamp(values[2], 100) / 100;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const channel = n => (lightness - a * Math.max(-1, Math.min((n + h) % 12 - 3, 9 - (n + h) % 12, 1))) * 255;
    return { r: channel(0), g: channel(8), b: channel(4) };
  }

  return null;
}

function isLikelyNeutralCssColor(colorRaw) {
  const parsed = parseCssColorToRgb(colorRaw);
  if (!parsed) return false;
  const values = [parsed.r, parsed.g, parsed.b];
  const spread = Math.max(...values) - Math.min(...values);
  return spread <= 18;
}

function extractCssVariableColorHints(cssSources = []) {
  const hits = new Map();
  const keywordWeights = [
    ['accent', 10],
    ['primary', 9],
    ['brand', 9],
    ['secondary', 8],
    ['highlight', 7],
    ['cta', 7],
    ['hero', 5],
    ['theme', 5],
    ['bg', 3],
    ['background', 3],
    ['text', 2],
  ];

  for (const cssText of cssSources.map(removeFrameworkPresets)) {
    const pattern = /--([a-z0-9-_]{2,60})\s*:\s*([^;}{]+)/gi;
    let match;
    while ((match = pattern.exec(String(cssText || '')))) {
      const variableName = normalizeString(match[1] || '').toLowerCase();
      const declaration = String(match[2] || '');
      const colors = extractColorTokensFromCss(declaration);
      if (!variableName || colors.length === 0 || /^(wp-|akismet-|swiper-)/.test(variableName)) continue;

      const color = colors[0];
      let score = isLikelyNeutralCssColor(color) ? 1 : 4;
      for (const [keyword, weight] of keywordWeights) {
        if (variableName.includes(keyword)) score += weight;
      }
      if (variableName.includes('text')) score -= 5;
      if (variableName.includes('bg') || variableName.includes('background')) score -= 2;

      const key = `${variableName}:${color}`;
      const existing = hits.get(key);
      if (!existing || existing.score < score) {
        hits.set(key, {
          name: variableName,
          color,
          score,
        });
      }
    }
  }

  return Array.from(hits.values())
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((entry) => `${entry.name}: ${entry.color}`);
}

function extractCssBrandPalette(cssSources = [], preferredColors = []) {
  const counts = new Map();
  const preferred = preferredColors
    .map((value) => normalizeString(value || '').toLowerCase())
    .filter(Boolean);

  for (const cssText of cssSources.map(removeFrameworkPresets)) {
    for (const color of extractColorTokensFromCss(cssText)) {
      const current = counts.get(color) || 0;
      const neutralPenalty = isLikelyNeutralCssColor(color) ? 0 : 2;
      counts.set(color, current + 1 + neutralPenalty);
    }
  }

  const palette = [];
  for (const color of preferred) {
    if (!palette.includes(color)) palette.push(color);
    if (palette.length >= 6) return palette;
  }

  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([color]) => color);

  for (const color of ranked) {
    if (!palette.includes(color)) palette.push(color);
    if (palette.length >= 6) break;
  }

  return palette.slice(0, 6);
}

function extractCssBrandColorEvidence(cssSources = []) {
  const evidence = new Map();
  for (const raw of cssSources) {
    const css = removeFrameworkPresets(raw);
    const variables = new Map([...css.matchAll(/--([a-z0-9-_]+)\s*:\s*([^;}{]+)/gi)]
      .map(match => [match[1], match[2]]));
    for (const [name, declaration] of variables) {
      if (/^(wp-|bs-|akismet-|swiper-)/.test(name) || !/(?:brand|primary|secondary|accent)/i.test(name)) continue;
      for (const color of extractColorTokensFromCss(declaration)) evidence.set(color, { color, role: name });
    }
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
      const selector = rule[1];
      if (!/(?:button|\.btn|header|navbar|navigation|logo)/i.test(selector) || /cookie|consent|success|danger|warning|admin|woocommerce|swiper/i.test(selector)) continue;
      for (const declaration of rule[2].matchAll(/(?:^|;)\s*(?:background(?:-color)?|color|fill)\s*:\s*([^;]+)/gi)) {
        const value = declaration[1].replace(/var\(--([a-z0-9-_]+)\)/gi, (_, name) => variables.get(name) || '');
        for (const color of extractColorTokensFromCss(value)) evidence.set(color, { color, role: 'brand-ui' });
      }
    }
  }
  return [...evidence.values()].filter(v => parseCssColorToRgb(v.color)).slice(0, 60);
}

module.exports = { extractCssVariableColorHints, extractCssBrandPalette, parseCssColorToRgb, extractCssBrandColorEvidence };
