'use strict';

// JSON.stringify accepts isolated UTF-16 surrogates, but PostgREST/JSONB does not.
// PostgreSQL text also rejects NUL. Repair display text after every truncation.
function sanitizeMailboxStorageText(value) {
  return typeof value === 'string' ? value.toWellFormed().replace(/\u0000/g, '\uFFFD') : value;
}

function prepareMailboxMessageRowForStorage(row) {
  for (const key of ['sender_name', 'sender_email', 'recipients_text', 'subject', 'preview', 'body_text']) {
    row[key] = sanitizeMailboxStorageText(row[key]);
  }
  for (const key of ['toDisplay', 'cc', 'bcc', 'deliveredTo']) {
    if (Object.hasOwn(row.payload, key)) row.payload[key] = sanitizeMailboxStorageText(row.payload[key]);
  }
  for (const attachment of row.payload.attachments || []) {
    attachment.filename = sanitizeMailboxStorageText(attachment.filename);
    attachment.contentType = sanitizeMailboxStorageText(attachment.contentType);
  }
  // Message identity, UID generation, thread provenance and link evidence stay exact.
  return row;
}

module.exports = { sanitizeMailboxStorageText, prepareMailboxMessageRowForStorage };
