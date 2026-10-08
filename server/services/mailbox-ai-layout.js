'use strict';
const contract = require('../../assets/premium-mailbox-ai-presentation');
const { restoreMailboxParagraphs } = require('./mailbox-provider-rich-body');

function restoreMailboxDisplayLayout(source) {
  return restoreMailboxParagraphs(source.body, source.html, { allowHtmlOnlyLines: true });
}

// Reuse paid decisions against their original source. Only whitespace changes;
// labels and literal contacts follow the same character ranges, never new text.
function restoreMailboxAiDecision(source, decision) {
  if (!contract.validate(source.body, decision)) return decision;
  const original = decision.displayBody ?? source.body;
  const restored = restoreMailboxDisplayLayout({ ...source, body: original });
  if (original === restored) return decision;
  function ranges(body) {
    let offset = 0;
    return body.split(/\r?\n/).map((line, index) => {
      const start = offset;
      offset += line.replace(/\s/g, '').length;
      return { line, index, start, end: offset };
    });
  }
  const before = ranges(original), after = ranges(restored);
  const overlaps = (left, right) => left.start < right.end && right.start < left.end;
  let cursor = 0;
  const labels = after.map((row) => {
    while (cursor < before.length && before[cursor].end <= row.start) cursor += 1;
    const owners = [];
    for (let i = cursor; i < before.length && before[i].start < row.end; i += 1) {
      if (overlaps(row, before[i])) owners.push(before[i]);
    }
    // A new line spanning mixed labels must remain visible in its entirety.
    return owners.length && owners.every((old) => decision.labels[old.index] === 'signature')
      ? 'signature' : 'authored';
  });
  const contacts = [];
  for (const contact of decision.contacts) {
    const candidates = after.filter((row) => overlaps(row, before[contact.line]) &&
      labels[row.index] === 'signature' && row.line.includes(contact.text));
    // If a contact cannot be located uniquely, preserve the complete old view.
    if (candidates.length !== 1) return decision;
    contacts.push({ ...contact, line: candidates[0].index });
  }
  const result = { ...decision, displayBody: restored, labels, contacts };
  return contract.validate(source.body, result) ? result : decision;
}

module.exports = { restoreMailboxDisplayLayout, restoreMailboxAiDecision };
