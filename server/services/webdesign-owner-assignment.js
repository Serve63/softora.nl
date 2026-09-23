'use strict';

async function assignWebdesignOwner(customer, dataOpsStore, logger = console) {
  if (!dataOpsStore || typeof dataOpsStore.assignWebdesignOwner !== 'function') {
    return {
      ok: false, statusCode: 503, error: 'Ontwerpverdeling niet beschikbaar',
      detail: 'De centrale ontwerpverdeling ontbreekt; er is geen webdesign gestart.',
    };
  }
  let ownerEmail = '';
  try {
    ownerEmail = await dataOpsStore.assignWebdesignOwner(customer.id);
  } catch (error) {
    if (typeof logger.error === 'function') logger.error('[PremiumDatabaseWebdesignJobs][owner-rotation]', error && error.message ? error.message : error);
    return {
      ok: false, statusCode: 503, error: 'Ontwerpverdeling niet beschikbaar',
      detail: 'De centrale ontwerpeigenaar kon niet veilig worden vastgelegd; er is geen webdesign gestart.',
    };
  }
  if (!['serve@softora.nl', 'martijn@softora.nl'].includes(ownerEmail)) {
    return {
      ok: false, statusCode: 503, error: 'Ontwerpverdeling ongeldig',
      detail: 'De toegewezen ontwerpeigenaar is ongeldig; er is geen webdesign gestart.',
    };
  }
  return { ok: true, ownerEmail };
}

module.exports = { assignWebdesignOwner };
