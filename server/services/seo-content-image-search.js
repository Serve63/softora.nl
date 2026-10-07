function getSeoImageSitemapEntries(...images) {
  return images
    .filter((image) => image && image.src)
    .map((image) => ({ loc: image.src, alt: image.alt }));
}

function buildSeoImagePreviewMeta(imageUrl, image) {
  const meta = [`<meta property="og:image" content="${imageUrl}">`];
  if (Number(image?.width) > 0 && Number(image?.height) > 0) {
    meta.push(`<meta property="og:image:width" content="${Number(image.width)}">`);
    meta.push(`<meta property="og:image:height" content="${Number(image.height)}">`);
  }
  return meta;
}

function buildSeoImageObject(imageUrl, image) {
  return {
    '@type': 'ImageObject',
    contentUrl: imageUrl,
    width: Number(image?.width) || undefined,
    height: Number(image?.height) || undefined,
    caption: image?.alt,
  };
}

function getSeoArticleImages(item, hero = item?.image) {
  return [hero, item?.secondaryImage, ...(item?.sections || []).map(section => section.image)]
    .filter(image => image?.src);
}

function renderSeoImageResponsiveAttributes(image, escapeHtml) {
  if (!image?.srcset) return '';
  return ` srcset="${escapeHtml(image.srcset)}" sizes="${escapeHtml(image.sizes || '100vw')}"`;
}

function renderSeoSupportImage(image, escapeHtml) {
  if (!image?.src) return '';
  const dimensions = Number(image.width) > 0 && Number(image.height) > 0
    ? ` width="${Number(image.width)}" height="${Number(image.height)}"` : '';
  return [
    '    <figure class="artikel-support-image">',
    `      <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"${dimensions}${renderSeoImageResponsiveAttributes(image, escapeHtml)} loading="lazy" decoding="async" fetchpriority="low">`,
    image.caption ? `      <figcaption>${escapeHtml(image.caption)}</figcaption>` : '',
    '    </figure>',
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildSeoImageObject,
  buildSeoImagePreviewMeta,
  getSeoImageSitemapEntries, getSeoArticleImages, renderSeoImageResponsiveAttributes, renderSeoSupportImage,
};
