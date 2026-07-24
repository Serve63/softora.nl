function buildMailboxMessageMetadataHelpers(deps = {}) {
  const {
    normalizeEmail = (value) => String(value || '').trim().toLowerCase(),
    normalizeString = (value) => String(value || '').trim(),
  } = deps;

  function addressDisplayText(address) {
    const source = address && typeof address === 'object' && !Array.isArray(address) ? address : null;
    const directText = normalizeString(source && source.text);
    if (directText) return directText;
    const list = Array.isArray(source && source.value)
      ? source.value
      : Array.isArray(address)
        ? address
        : source
          ? [source]
          : [];
    return list
      .map((item) => {
        const name = normalizeString(item && item.name);
        const email = normalizeEmail(item && item.address);
        if (name && email) return `${name} <${email}>`;
        return email || name;
      })
      .filter(Boolean)
      .join(', ');
  }

  function parsedHeaderText(parsed, name) {
    const value = parsed && parsed.headers && typeof parsed.headers.get === 'function'
      ? parsed.headers.get(name)
      : '';
    if (typeof value === 'string') return normalizeString(value);
    return addressDisplayText(value);
  }

  function buildAttachmentMetadata(parsed = {}) {
    return (Array.isArray(parsed.attachments) ? parsed.attachments : [])
      .filter((attachment) => {
        const disposition = String(attachment && attachment.contentDisposition || '').toLowerCase();
        return disposition === 'attachment' || (!attachment.cid && disposition !== 'inline');
      })
      .slice(0, 20)
      .map((attachment) => ({
        filename: String(attachment && attachment.filename || 'Bijlage').trim().slice(0, 180),
        contentType: String(attachment && attachment.contentType || 'application/octet-stream')
          .split(';')[0]
          .trim()
          .toLowerCase(),
        size: Math.max(
          0,
          Number(attachment && attachment.size) ||
            Buffer.byteLength(attachment && attachment.content || '')
        ),
      }));
  }

  return {
    addressDisplayText,
    buildAttachmentMetadata,
    parsedHeaderText,
  };
}

module.exports = {
  buildMailboxMessageMetadataHelpers,
};
