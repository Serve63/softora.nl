const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const VISUAL_QUALITY_EFFECTIVE_DATE = '2026-08-05';
const DEFAULT_RECENT_VISUAL_WINDOW = 6;
const DEFAULT_VISUAL_SIMILARITY_THRESHOLD = 0.85;
const TARGET_IMAGE_ASPECT_RATIO = 16 / 9;
const ASPECT_RATIO_TOLERANCE = 0.04;

const ALLOWED_HERO_VISUAL_TYPES = Object.freeze([
  'editorial-scene',
  'product-interface',
  'annotated-workflow',
  'data-visualization',
  'architectural-diagram',
  'object-study',
  'documentary-process',
]);

const ALLOWED_SUPPORT_VISUAL_TYPES = Object.freeze([
  'decision-matrix',
  'decision-tree',
  'process-diagram',
  'annotated-interface',
  'architecture-diagram',
  'data-visualization',
  'comparison-board',
  'checklist',
]);

function getVisualEventDate(item) {
  if (item?.growthEventKind === 'substantial_refresh' && item.growthEventAt) {
    return String(item.growthEventAt);
  }
  return String(item?.publishedAt || '');
}

function getVisualItemKey(item) {
  return `${String(item?.collection || '')}/${String(item?.slug || '')}`;
}

function requiresVisualQualityV2(item, effectiveDate = VISUAL_QUALITY_EFFECTIVE_DATE) {
  return (
    String(item?.collection || '') === 'blog' &&
    getVisualEventDate(item) >= String(effectiveDate)
  );
}

function getItemVisuals(item) {
  return [
    item?.image?.src ? { role: 'hero', image: item.image } : null,
    item?.secondaryImage?.src ? { role: 'support', image: item.secondaryImage } : null,
  ].filter(Boolean);
}

function issue(type, item, message, extra = {}) {
  return {
    type,
    path: `/${String(item?.collection || '')}/${String(item?.slug || '')}`,
    message,
    ...extra,
  };
}

function hasUsefulText(value, minimumLength) {
  return String(value || '').trim().length >= minimumLength;
}

function hasVisualFamily(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(String(value || '').trim());
}

function auditVisualBriefs({
  items = [],
  effectiveDate = VISUAL_QUALITY_EFFECTIVE_DATE,
  recentWindow = DEFAULT_RECENT_VISUAL_WINDOW,
} = {}) {
  const issues = [];
  const blogItems = (Array.isArray(items) ? items : [])
    .filter((item) => String(item?.collection || '') === 'blog')
    .sort((left, right) => getVisualEventDate(left).localeCompare(getVisualEventDate(right)));

  for (const item of blogItems) {
    if (!requiresVisualQualityV2(item, effectiveDate)) continue;

    const label = `/${item.collection}/${item.slug}`;
    const brief = item.visualBrief || {};
    const hero = brief.hero || {};
    const support = brief.support || {};
    const visuals = getItemVisuals(item);

    if (Number(item.visualQualityVersion) < 2) {
      issues.push(issue('missing-visual-quality-version', item, `${label} mist visualQualityVersion 2.`));
    }
    if (visuals.length !== 2) {
      issues.push(issue('wrong-visual-count', item, `${label} moet exact twee eigen beelden hebben.`));
    }
    if (hero.role !== 'representative' || support.role !== 'explanatory') {
      issues.push(issue('invalid-visual-roles', item, `${label} mist een representatieve hero en verklarend supportbeeld.`));
    }
    if (!ALLOWED_HERO_VISUAL_TYPES.includes(hero.visualType)) {
      issues.push(issue('invalid-hero-visual-type', item, `${label} gebruikt geen toegestane hero-beeldvorm.`));
    }
    if (!ALLOWED_SUPPORT_VISUAL_TYPES.includes(support.visualType)) {
      issues.push(issue('invalid-support-visual-type', item, `${label} gebruikt geen toegestane support-beeldvorm.`));
    }
    if (!hasVisualFamily(hero.visualFamily) || !hasVisualFamily(support.visualFamily)) {
      issues.push(issue('missing-visual-family', item, `${label} mist machineleesbare visuele families.`));
    }
    if (hero.visualFamily && hero.visualFamily === support.visualFamily) {
      issues.push(issue('same-visual-family', item, `${label} gebruikt voor beide beelden dezelfde visuele familie.`));
    }
    if (hero.visualType && hero.visualType === support.visualType) {
      issues.push(issue('same-visual-type', item, `${label} gebruikt voor beide beelden dezelfde beeldvorm.`));
    }
    for (const [role, entry] of [['hero', hero], ['support', support]]) {
      if (!hasUsefulText(entry.composition, 30)) {
        issues.push(issue('weak-visual-composition', item, `${label} mist een concrete compositiebrief voor ${role}.`));
      }
      if (!hasUsefulText(entry.informationGoal, 60)) {
        issues.push(issue('weak-visual-information-goal', item, `${label} mist aantoonbare informatiewinst voor ${role}.`));
      }
      if (!hasUsefulText(entry.differenceFromRecent, 80)) {
        issues.push(issue('weak-recent-visual-difference', item, `${label} legt niet concreet uit hoe ${role} afwijkt van recente beelden.`));
      }
      if (entry.sourceType !== 'trainedAlgorithmicMedia') {
        issues.push(issue('missing-ai-source-type', item, `${label} mist de correcte AI-herkomstcode voor ${role}.`));
      }
    }
    if (!['none', 'minimal'].includes(hero.textDensity) || hero.previewSafe !== true) {
      issues.push(issue('weak-search-preview-hero', item, `${label} heeft geen tekstarm, preview-veilig hero-beeld.`));
    }
    if (!['none', 'minimal', 'moderate'].includes(support.textDensity)) {
      issues.push(issue('invalid-support-text-density', item, `${label} mist een begrensde tekstdichtheid voor het supportbeeld.`));
    }

    for (const { role, image } of visuals) {
      const width = Number(image.width);
      const height = Number(image.height);
      const ratio = width > 0 && height > 0 ? width / height : 0;
      if (width < 1200 || width * height < 300000) {
        issues.push(issue('image-too-small', item, `${label} heeft een te klein ${role}-beeld voor een sterke zoekpreview.`));
      }
      if (!ratio || Math.abs(ratio - TARGET_IMAGE_ASPECT_RATIO) > ASPECT_RATIO_TOLERANCE) {
        issues.push(issue('non-landscape-preview-ratio', item, `${label} gebruikt voor ${role} niet het vereiste 16:9-formaat.`));
      }
    }

    const itemIndex = blogItems.indexOf(item);
    const recentItems = blogItems.slice(Math.max(0, itemIndex - recentWindow), itemIndex);
    const recentFamilies = new Set(
      recentItems.flatMap((recentItem) => [
        recentItem?.visualBrief?.hero?.visualFamily,
        recentItem?.visualBrief?.support?.visualFamily,
      ]).filter(Boolean)
    );
    for (const family of [hero.visualFamily, support.visualFamily].filter(Boolean)) {
      if (recentFamilies.has(family)) {
        issues.push(issue('repeated-recent-visual-family', item, `${label} herhaalt binnen ${recentWindow} publicaties de visuele familie ${family}.`, { family }));
      }
    }
  }

  return issues;
}

function cosineSimilarity(left = [], right = []) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftLength += left[index] * left[index];
    rightLength += right[index] * right[index];
  }
  if (!leftLength || !rightLength) return 0;
  return dot / Math.sqrt(leftLength * rightLength);
}

async function buildImageDescriptor(filePath) {
  const { data } = await sharp(filePath)
    .resize(16, 10, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Array.from(data);
  const colorGrid = pixels.map((value) => value / 255);
  const grayGrid = [];
  const histogram = Array(64).fill(0);

  for (let index = 0; index < pixels.length; index += 3) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    grayGrid.push((red + green + blue) / 765);
    histogram[(red >> 6) * 16 + (green >> 6) * 4 + (blue >> 6)] += 1;
  }

  const edgeGrid = [];
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const index = y * 16 + x;
      const horizontal = x ? Math.abs(grayGrid[index] - grayGrid[index - 1]) : 0;
      const vertical = y ? Math.abs(grayGrid[index] - grayGrid[index - 16]) : 0;
      edgeGrid.push((horizontal + vertical) / 2);
    }
  }

  return { colorGrid, edgeGrid, histogram };
}

function compareImageDescriptors(left, right) {
  const color = cosineSimilarity(left?.colorGrid, right?.colorGrid);
  const edges = cosineSimilarity(left?.edgeGrid, right?.edgeGrid);
  const palette = cosineSimilarity(left?.histogram, right?.histogram);
  return {
    color: Math.round(color * 1000) / 1000,
    edges: Math.round(edges * 1000) / 1000,
    palette: Math.round(palette * 1000) / 1000,
    combined: Math.round((color * 0.4 + edges * 0.25 + palette * 0.35) * 1000) / 1000,
  };
}

function resolveAssetPath(repoRoot, src) {
  const normalized = String(src || '').replace(/^\/+/, '');
  if (!normalized.startsWith('assets/seo-content/')) return '';
  return path.join(repoRoot, normalized);
}

async function loadDescriptors({ items, repoRoot, descriptorMap = new Map() }) {
  const descriptors = new Map(descriptorMap);
  const errors = [];
  for (const item of items) {
    for (const { image } of getItemVisuals(item)) {
      const src = String(image.src || '');
      if (descriptors.has(src)) continue;
      const filePath = resolveAssetPath(repoRoot, src);
      if (!filePath || !fs.existsSync(filePath)) {
        errors.push({ src, error: 'missing_asset' });
        continue;
      }
      try {
        descriptors.set(src, await buildImageDescriptor(filePath));
      } catch (error) {
        errors.push({ src, error: error.message || String(error) });
      }
    }
  }
  return { descriptors, errors };
}

function compareVisualPairs({ items, descriptors, threshold, excludeSameItem = false }) {
  const visuals = items.flatMap((item) => getItemVisuals(item).map((entry) => ({
    ...entry,
    item,
    itemKey: getVisualItemKey(item),
    src: entry.image.src,
  })));
  const pairs = [];
  for (let leftIndex = 0; leftIndex < visuals.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < visuals.length; rightIndex += 1) {
      const left = visuals[leftIndex];
      const right = visuals[rightIndex];
      if (excludeSameItem && left.itemKey === right.itemKey) continue;
      if (!descriptors.has(left.src) || !descriptors.has(right.src)) continue;
      const similarity = compareImageDescriptors(descriptors.get(left.src), descriptors.get(right.src));
      if (similarity.combined < threshold) continue;
      pairs.push({
        left: { item: left.itemKey, role: left.role, src: left.src },
        right: { item: right.itemKey, role: right.role, src: right.src },
        ...similarity,
      });
    }
  }
  return pairs.sort((left, right) => right.combined - left.combined);
}

async function buildVisualQualityReport({
  items = [],
  repoRoot = path.resolve(__dirname, '../..'),
  effectiveDate = VISUAL_QUALITY_EFFECTIVE_DATE,
  recentWindow = DEFAULT_RECENT_VISUAL_WINDOW,
  similarityThreshold = DEFAULT_VISUAL_SIMILARITY_THRESHOLD,
  descriptorMap,
} = {}) {
  const blogItems = (Array.isArray(items) ? items : [])
    .filter((item) => String(item?.collection || '') === 'blog')
    .sort((left, right) => getVisualEventDate(right).localeCompare(getVisualEventDate(left)));
  const candidates = blogItems.filter((item) => requiresVisualQualityV2(item, effectiveDate));
  const recentItems = blogItems.slice(0, recentWindow);
  const descriptorItems = Array.from(new Set([...recentItems, ...candidates]));
  const { descriptors, errors } = await loadDescriptors({ items: descriptorItems, repoRoot, descriptorMap });
  const issues = auditVisualBriefs({ items: blogItems, effectiveDate, recentWindow });

  for (const candidate of candidates) {
    for (const { image } of getItemVisuals(candidate)) {
      if (!descriptors.has(image.src)) {
        issues.push(issue('missing-visual-asset', candidate, `${getVisualItemKey(candidate)} mist een leesbaar lokaal beeldasset: ${image.src}.`));
      }
    }
    const candidateDate = getVisualEventDate(candidate);
    const references = blogItems
      .filter((item) => item !== candidate && getVisualEventDate(item) <= candidateDate)
      .slice(0, recentWindow);
    const candidatePairs = compareVisualPairs({
      items: [candidate, ...references],
      descriptors,
      threshold: similarityThreshold,
      excludeSameItem: false,
    }).filter((pair) => pair.left.item === getVisualItemKey(candidate) || pair.right.item === getVisualItemKey(candidate));
    for (const pair of candidatePairs) {
      issues.push(issue(
        'recent-visual-similarity',
        candidate,
        `${getVisualItemKey(candidate)} lijkt te sterk op recent beeldmateriaal (${pair.combined}).`,
        { pair }
      ));
    }
  }

  const legacySimilarityPairs = compareVisualPairs({
    items: recentItems,
    descriptors,
    threshold: similarityThreshold,
  });

  return {
    status: issues.length ? 'blocked' : 'ready',
    effectiveDate,
    recentWindow,
    similarityThreshold,
    candidateCount: candidates.length,
    checkedRecentItems: recentItems.map(getVisualItemKey),
    issues,
    descriptorErrors: errors,
    legacyDebt: {
      status: legacySimilarityPairs.length ? 'quality_recovery' : 'healthy',
      similarPairCount: legacySimilarityPairs.length,
      nearestPairs: legacySimilarityPairs.slice(0, 10),
    },
  };
}

module.exports = {
  ALLOWED_HERO_VISUAL_TYPES,
  ALLOWED_SUPPORT_VISUAL_TYPES,
  ASPECT_RATIO_TOLERANCE,
  DEFAULT_RECENT_VISUAL_WINDOW,
  DEFAULT_VISUAL_SIMILARITY_THRESHOLD,
  TARGET_IMAGE_ASPECT_RATIO,
  VISUAL_QUALITY_EFFECTIVE_DATE,
  auditVisualBriefs,
  buildImageDescriptor,
  buildVisualQualityReport,
  compareImageDescriptors,
  cosineSimilarity,
  getVisualEventDate,
  requiresVisualQualityV2,
};
