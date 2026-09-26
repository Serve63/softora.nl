// Instantly requires explicit HTML breaks for line breaks in delivered replies.
// Keep the text alternative, and escape user text before producing HTML.
function buildInstantlyReplyBody(text) {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r\n|\r|\n/g, '<br/>');
  return { text, html };
}

module.exports = { buildInstantlyReplyBody };
