const PUBLICATION_LANES = Object.freeze({
  EDITORIAL: 'editorial',
  MONEY_PAGE: 'money_page',
  OTHER: 'other',
  UNCLASSIFIED: 'unclassified',
});

const EDITORIAL_COLLECTIONS = new Set(['blog', 'kennisbank', 'vergelijkingen']);
const MONEY_PAGE_COLLECTIONS = new Set(['branches', 'regio', 'service']);
const OTHER_COLLECTIONS = new Set(['home', 'contact', 'collection', 'about', 'legal']);

function normalizeCollection(value) {
  return String(value || '').trim().toLowerCase();
}

function resolvePublicationLane(item = {}) {
  const explicitLane = normalizeCollection(item.publicationLane);
  if (Object.values(PUBLICATION_LANES).includes(explicitLane)) return explicitLane;

  const collection = normalizeCollection(item.collection || item.contentType || item.kind);
  if (EDITORIAL_COLLECTIONS.has(collection)) return PUBLICATION_LANES.EDITORIAL;
  if (MONEY_PAGE_COLLECTIONS.has(collection)) return PUBLICATION_LANES.MONEY_PAGE;
  if (OTHER_COLLECTIONS.has(collection)) return PUBLICATION_LANES.OTHER;
  return PUBLICATION_LANES.UNCLASSIFIED;
}

module.exports = {
  EDITORIAL_COLLECTIONS,
  MONEY_PAGE_COLLECTIONS,
  OTHER_COLLECTIONS,
  PUBLICATION_LANES,
  resolvePublicationLane,
};
