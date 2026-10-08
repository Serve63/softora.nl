function getDesignPhotoCreatedAt(row = {}) {
  const meta = row.legacyMeta || row.legacy_meta || {};
  const value = row.websitePhotoCreatedAt || meta.websitePhotoCreatedAt || (meta.generationJobId && meta.mockupQualityCheckedAt) || '';
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(value))) return '';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}
module.exports = { getDesignPhotoCreatedAt };
