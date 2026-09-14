async function writeChunks(rows, size, writer) {
  let count = 0;
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    const result = await writer(chunk);
    if (!result || result.ok !== true) return result || { ok: false };
    count += Array.isArray(result.data) ? result.data.length : chunk.length;
  }
  return { ok: true, count };
}

async function syncOutboundGuardRows(options = {}) {
  const guardRows = Array.isArray(options.guardRows) ? options.guardRows : [];
  const existingRows = options.existingRows instanceof Map ? options.existingRows : new Map();
  const missingRows = guardRows.filter((row) => !existingRows.has(row.guard_key));
  const queuedRows = guardRows.filter((row) => {
    const current = existingRows.get(row.guard_key);
    return current && String(current.status || '').trim().toLowerCase() !== 'sent';
  });
  const inserted = await writeChunks(missingRows, 500, options.insertRows);
  if (!inserted.ok) return inserted;
  const promoted = await writeChunks(queuedRows, 500, options.promoteRows);
  if (!promoted.ok) return promoted;
  return { ok: true, inserted: inserted.count, promoted: promoted.count, expected: guardRows.length };
}

module.exports = { syncOutboundGuardRows };
