'use strict';

function createWebdesignOwnerRotationRepository({ run, getWriteOperationOptions, normalizeString }) {
  async function assignWebdesignOwner(customerId) {
    const id = normalizeString(customerId);
    if (!id || id.length > 160) throw new Error('Ongeldig klant-ID voor webdesign-eigenaar.');
    const result = await run('assign-webdesign-owner', (client) =>
      client.rpc('softora_assign_webdesign_owner', { p_customer_id: id }),
    getWriteOperationOptions());
    if (!result.ok) throw result.error || new Error('Webdesign-eigenaar kon niet worden toegewezen.');
    const ownerEmail = normalizeString(result.data).toLowerCase();
    if (!['serve@softora.nl', 'martijn@softora.nl'].includes(ownerEmail)) {
      throw new Error('Webdesign-eigenaar uit de centrale rotatie is ongeldig.');
    }
    return ownerEmail;
  }
  return { assignWebdesignOwner };
}

module.exports = { createWebdesignOwnerRotationRepository };
