const WEBDESIGN_VARIANT_V1 = 'v1-prompt-only';
const WEBDESIGN_VARIANT_V2 = 'v2-visual-dna';
const WEBDESIGN_GENERATION_POLICY = 'customer-website-only-v2';

function normalizeWebdesignVariant(value) {
  return String(value || '').trim().toLowerCase() === WEBDESIGN_VARIANT_V2
    ? WEBDESIGN_VARIANT_V2
    : WEBDESIGN_VARIANT_V1;
}

function buildWebdesignGenerationProvenance(job = {}) {
  return {
    generationPolicy: WEBDESIGN_GENERATION_POLICY,
    generationJobId: String(job.id || '').trim(),
    generationVariant: normalizeWebdesignVariant(job.variant),
  };
}

function isDesignPhotoIncidentQuarantined(row) {
  const legacyMeta = row && row.legacy_meta && typeof row.legacy_meta === 'object' ? row.legacy_meta : {};
  const quarantine = legacyMeta.incidentQuarantine;
  return Boolean(quarantine && typeof quarantine === 'object' && quarantine.active === true);
}

function filterDesignPhotoRowsForServing(input) {
  const rows = Array.isArray(input) ? input : [];
  const incidentQuarantinedCustomerIds = rows
    .filter((row) => isDesignPhotoIncidentQuarantined(row))
    .map((row) => String(row && row.customer_id || '').trim())
    .filter(Boolean);
  const availableRows = rows.filter((row) => !isDesignPhotoIncidentQuarantined(row));
  Object.defineProperty(availableRows, 'incidentQuarantinedCustomerIds', {
    value: Array.from(new Set(incidentQuarantinedCustomerIds)),
    enumerable: false,
  });
  return availableRows;
}

function markIncidentQuarantinedDesignPhotosAuthoritative(photoMap, rowsByCustomerId, signedRows) {
  const quarantinedIds = Array.isArray(signedRows?.incidentQuarantinedCustomerIds)
    ? signedRows.incidentQuarantinedCustomerIds
    : [];
  quarantinedIds.forEach((customerId) => {
    const exactMatch = rowsByCustomerId.get(String(customerId || '').trim().toLowerCase());
    if (exactMatch) photoMap[exactMatch.customerId] = { id: exactMatch.customerId, authoritativeMissing: true };
  });
  return photoMap;
}

function markMissingDesignPhotosAuthoritative(photoMap, rowsByCustomerId, hasReadyAsset) {
  rowsByCustomerId.forEach(({ customerId }) => {
    if (!hasReadyAsset(photoMap[customerId])) photoMap[customerId] = { id: customerId, authoritativeMissing: true };
  });
  return photoMap;
}

module.exports = {
  WEBDESIGN_VARIANT_V1,
  WEBDESIGN_VARIANT_V2,
  buildWebdesignGenerationProvenance,
  filterDesignPhotoRowsForServing,
  isDesignPhotoIncidentQuarantined,
  markIncidentQuarantinedDesignPhotosAuthoritative,
  markMissingDesignPhotosAuthoritative,
  normalizeWebdesignVariant,
};
