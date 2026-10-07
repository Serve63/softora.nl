const MAX_INVENTORY_ROWS = 100000;

async function readKvkInventoryRows(db) {
  const { data, error } = await db.rpc('softora_kvk_unused_inventory_rows');
  if (error || !Array.isArray(data)) throw new Error('Uploadvoorraad kon niet worden geladen.');
  if (data.length > MAX_INVENTORY_ROWS) throw new Error('De uploadvoorraad is te groot om volledig te laden.');
  let after = 0;
  for (const row of data) {
    const id = Number(row?.source_company_id);
    if (!Number.isSafeInteger(id) || id <= after) throw new Error('Uploadvoorraad bevat een ongeldige paginavolgorde.');
    after = id;
  }
  return data;
}

module.exports = { MAX_INVENTORY_ROWS, readKvkInventoryRows };
