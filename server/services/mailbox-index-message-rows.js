function deduplicateRowsByKey(rows, keyName) {
  const rowsByKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = String(row && row[keyName] || '').trim();
    if (key) rowsByKey.set(key, row);
  });
  return Array.from(rowsByKey.values());
}

module.exports = {
  deduplicateRowsByKey,
};
