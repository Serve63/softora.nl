// Keeps the sign-off of the approved Instantly campaign templates equal to the
// Softora coldmail sign-off: sender name, "Softora.nl | Webdesign", 📍 city.
// Instantly's editor is read-only for these campaigns, so Softora patches the
// sequence itself before it adds new leads.

const INSTANTLY_SIGNATURE_LINE = 'Softora.nl | Webdesign';
const SIGNATURE_PRESENT_PATTERN = /Softora\.nl\s*(?:\||&#124;|&vert;)\s*Webdesign/i;
const SENDER_THEN_CITY_PATTERN =
  /(\{\{\s*softora_sender_name\s*\}\})((?:\s|&nbsp;|<br\s*\/?>|<\/(?:div|p|span)>|<(?:div|p|span)\b[^>]*>)*📍)/g;

function addSignatureLineToBody(body) {
  const value = typeof body === 'string' ? body : '';
  if (!value) return { body: value, changed: false, reason: 'empty' };
  if (SIGNATURE_PRESENT_PATTERN.test(value)) return { body: value, changed: false, reason: 'present' };
  const matches = value.match(SENDER_THEN_CITY_PATTERN) || [];
  // Only touch a template whose sign-off is unambiguous.
  if (matches.length !== 1) return { body: value, changed: false, reason: matches.length ? 'ambiguous' : 'no_anchor' };
  const next = value.replace(SENDER_THEN_CITY_PATTERN, (match, sender, between) => {
    const separator = /</.test(between) || /<[a-z]/i.test(value) ? '<br>' : '\n';
    return `${sender}${separator}${INSTANTLY_SIGNATURE_LINE}${between}`;
  });
  return { body: next, changed: next !== value, reason: 'added' };
}

function buildCampaignSignatureSequences(campaign) {
  const sequences = campaign && Array.isArray(campaign.sequences) ? campaign.sequences : null;
  if (!sequences || !sequences.length) return { changed: false, sequences: null };
  let changed = false;
  const nextSequences = sequences.map((sequence) => {
    if (!sequence || !Array.isArray(sequence.steps)) return sequence;
    return {
      ...sequence,
      steps: sequence.steps.map((step) => {
        if (!step || !Array.isArray(step.variants)) return step;
        return {
          ...step,
          variants: step.variants.map((variant) => {
            if (!variant || typeof variant.body !== 'string') return variant;
            const result = addSignatureLineToBody(variant.body);
            if (!result.changed) return variant;
            changed = true;
            return { ...variant, body: result.body };
          }),
        };
      }),
    };
  });
  return { changed, sequences: changed ? nextSequences : null };
}

module.exports = {
  INSTANTLY_SIGNATURE_LINE,
  addSignatureLineToBody,
  buildCampaignSignatureSequences,
};
