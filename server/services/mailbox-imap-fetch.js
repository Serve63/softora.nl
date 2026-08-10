async function fetchSelectedMailboxMessages({
  account,
  buildMailboxBodyImages,
  client,
  folder,
  normalizeString,
  parseMailSource,
  sanitizeMailboxDisplayText,
  selectedUids = [],
  toClientMessage,
} = {}) {
  const records = [];
  for await (const message of client.fetch(
    selectedUids,
    { uid: true, flags: true, internalDate: true, source: true },
    { uid: true }
  )) {
    const parsed = await parseMailSource(message.source);
    const text = sanitizeMailboxDisplayText(normalizeString(parsed.text || parsed.html || ''));
    const primaryBodyImages = buildMailboxBodyImages(parsed);
    records.push({
      message,
      parsed,
      text,
      primaryBodyImages,
    });
  }
  const messages = records.map((record) => toClientMessage(
    record.parsed,
    record.message,
    folder,
    account,
    { text: record.text, primaryBodyImages: record.primaryBodyImages }
  ));
  return messages.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}

module.exports = { fetchSelectedMailboxMessages };
