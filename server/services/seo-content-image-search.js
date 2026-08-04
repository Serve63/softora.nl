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

module.exports = {
  buildSeoImageObject,
  buildSeoImagePreviewMeta,
  getSeoImageSitemapEntries,
};
