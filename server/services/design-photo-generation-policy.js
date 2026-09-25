const WEBDESIGN_VARIANT_V2 = 'v2-visual-dna';
const WEBDESIGN_GENERATION_POLICY = 'customer-website-only-v2';
const { OUTBOUND_SENDER_PROFILE_KEYS } = require('./outbound-sender-identity');

// V2 (homepage-screenshot + huiskleurcontrole) is the only webdesign generator.
// Stored jobs that still say 'v1-prompt-only' or have no variant run as V2 too.
function normalizeWebdesignVariant() {
  return WEBDESIGN_VARIANT_V2;
}

function buildWebdesignPipelineOptions({ source, company = '', domain = '' }) {
  return {
    allowScanFallback: true,
    imageSize: '1024x1536',
    disableReferenceImages: false,
    referenceImageMode: 'homepage-screenshot',
    requireReferenceImages: true,
    body: { source, action: 'webdesign', variant: WEBDESIGN_VARIANT_V2, company, domain },
  };
}

function buildWebdesignGenerationProvenance(job = {}) {
  const authenticatedEmail = String(job.ownerKey || '').split('::')[0].trim().toLowerCase();
  const assignedEmail = String(job.assignedDesignOwnerEmail || '').trim().toLowerCase();
  const senderEmail = job.customer && job.customer.webdesignMailProvider === 'instantly' &&
    OUTBOUND_SENDER_PROFILE_KEYS[assignedEmail || authenticatedEmail] ? assignedEmail || authenticatedEmail : '';
  return {
    generationPolicy: WEBDESIGN_GENERATION_POLICY,
    generationJobId: String(job.id || '').trim(),
    generationVariant: normalizeWebdesignVariant(job.variant),
    ...(assignedEmail ? { designOwnerEmail: assignedEmail } : {}),
    ...(senderEmail ? { senderEmail } : {}),
    ...(job.generation ? { generation: job.generation } : {}),
  };
}

function isAssignedWebdesignSenderAllowed(row, photo, senderEmail) {
  const sender = String(senderEmail || '').trim().toLowerCase();
  if (!sender) return true;
  const owners = [row && row.designOwnerEmail, photo && photo.designOwnerEmail,
    photo && photo.legacyMeta && photo.legacyMeta.designOwnerEmail,
    photo && photo.legacy_meta && photo.legacy_meta.designOwnerEmail]
    .map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  if (!owners.length) return true; // Existing designs retain their prior sender selection.
  const senderProfile = OUTBOUND_SENDER_PROFILE_KEYS[sender];
  return Boolean(senderProfile) && owners.every((owner) => OUTBOUND_SENDER_PROFILE_KEYS[owner] === senderProfile);
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
  WEBDESIGN_VARIANT_V2,
  buildWebdesignGenerationProvenance,
  isAssignedWebdesignSenderAllowed,
  buildWebdesignPipelineOptions,
  filterDesignPhotoRowsForServing,
  isDesignPhotoIncidentQuarantined,
  markIncidentQuarantinedDesignPhotosAuthoritative,
  markMissingDesignPhotosAuthoritative,
  normalizeWebdesignVariant,
};
