const SENT_CAMPAIGN_IMAGE_OWNER = 'sent-campaign';

function normalizeImageIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bodyImageIdentityKeys(image) {
  return Array.from(new Set([
    normalizeImageIdentity(image && (image.alt || image.cid)),
    String(image && image.dataUrl || '').trim(),
  ].filter(Boolean)));
}

function extractBodyImageLabels(text) {
  const labels = [];
  const seen = new Set();
  for (const match of String(text || '').matchAll(/\[image:\s*([^\]]+)\]/gi)) {
    const label = String(match[1] || '').trim();
    const key = normalizeImageIdentity(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels.slice(0, 8);
}

function imageLabelMatches(left, right) {
  const normalizedLeft = normalizeImageIdentity(left);
  const normalizedRight = normalizeImageIdentity(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      (normalizedLeft === normalizedRight ||
        normalizedLeft.includes(normalizedRight) ||
        normalizedRight.includes(normalizedLeft))
  );
}

function mergeMailboxBodyImages(primaryImages, fallbackImages, text, options = {}) {
  const images = Array.isArray(primaryImages) ? primaryImages : [];
  const fallbacks = Array.isArray(fallbackImages) ? fallbackImages : [];
  if (!fallbacks.length) return images;
  const labels = extractBodyImageLabels(text);
  const used = new Set(images.map((image) => normalizeImageIdentity(image.alt || image.cid || image.dataUrl)).filter(Boolean));
  const matchedFallbacks = fallbacks.filter((image) => {
    const key = normalizeImageIdentity(image.alt || image.cid || image.dataUrl);
    if (!key || used.has(key)) return false;
    if (!options.allowUnmatchedFallbacks && !labels.some((label) => imageLabelMatches(image.alt || image.cid || image.dataUrl, label))) return false;
    used.add(key);
    return true;
  });
  return [...images, ...matchedFallbacks].slice(0, 8);
}

function isSentCampaignDesignImage(image) {
  return /\b(?:webdesign|preview|device mockup|mockup|website generator)\b/.test(
    normalizeImageIdentity(image && (image.alt || image.cid))
  );
}

function tagSentCampaignBodyImages(bodyImages, options = {}) {
  const images = Array.isArray(bodyImages) ? bodyImages : [];
  if (String(options.folder || '').trim().toLowerCase() === 'sent') return images;
  const storedKeys = new Set(
    (Array.isArray(options.storedImages) ? options.storedImages : [])
      .flatMap(bodyImageIdentityKeys)
  );
  const quotedCampaign = Boolean(options.looksLikeCampaign);
  return images.map((image) => {
    const matchedStoredImage = bodyImageIdentityKeys(image).some((key) => storedKeys.has(key));
    if (!matchedStoredImage && !(quotedCampaign && isSentCampaignDesignImage(image))) return image;
    return {
      ...image,
      owner: SENT_CAMPAIGN_IMAGE_OWNER,
    };
  });
}

module.exports = {
  SENT_CAMPAIGN_IMAGE_OWNER,
  mergeMailboxBodyImages,
  tagSentCampaignBodyImages,
};
