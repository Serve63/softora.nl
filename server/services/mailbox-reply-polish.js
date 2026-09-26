// Deterministic finishing touches on a grounded reply, so house rules hold
// even when the model forgets them: thank people for taking the effort to
// respond, and never use "helemaal begrijpelijk".
const EFFORT_THANKS_PATTERN = /\bmoeite\b[^.!?]{0,60}\breageren\b/i;
const PLAIN_THANKS_PATTERN = /\b(?:dank\s*je\s*wel|dankjewel|dank\s+je|bedankt|hartelijk\s+dank)\s+voor\s+(?:je|jouw|uw)\s+(?:[\p{L}-]+\s+){0,2}?(?:reactie|antwoord|bericht|mail(?:tje)?)\b/iu;
const UNDERSTANDABLE_PATTERN = /\bhelemaal\s+begrijpelijk\b\s*(?:dat\b)?/gi;

function isFirstCustomerReply(conversation) {
  return !(Array.isArray(conversation) ? conversation : []).some((message) => message && message.folder === 'inbox');
}

function replaceUnderstandable(text) {
  return text.replace(UNDERSTANDABLE_PATTERN, (match, offset, whole) => {
    const followsDat = /dat$/i.test(match.trim());
    const atSentenceStart = offset === 0 || /[.!?]\s*$/.test(whole.slice(0, offset));
    const phrase = followsDat ? 'ik snap goed dat' : 'dat snap ik';
    const trailing = /\s$/.test(match) ? ' ' : '';
    return (atSentenceStart ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase) + trailing;
  });
}

function addEffortThanks(paragraphs, policy) {
  if (paragraphs.some((paragraph) => EFFORT_THANKS_PATTERN.test(paragraph))) return paragraphs;
  const thanks = 'bedankt dat je de moeite hebt genomen om te reageren';
  const index = paragraphs.findIndex((paragraph) => PLAIN_THANKS_PATTERN.test(paragraph));
  if (index >= 0) {
    return paragraphs.map((paragraph, current) => (current !== index ? paragraph : paragraph.replace(
      PLAIN_THANKS_PATTERN,
      (match, offset) => (offset === 0 || /[.!?]\s*$/.test(paragraph.slice(0, offset)) ? 'B' : 'b') + thanks.slice(1)
    )));
  }
  const [first, ...rest] = paragraphs;
  return [`B${thanks.slice(1)}${policy?.noFurtherContact ? '.' : '!'} ${first}`, ...rest];
}

function polishMailboxReplyParagraphs(paragraphs, options = {}) {
  let result = (Array.isArray(paragraphs) ? paragraphs : []).map((paragraph) => replaceUnderstandable(String(paragraph || '')));
  if (result.length && !options.short && isFirstCustomerReply(options.conversation)) {
    result = addEffortThanks(result, options.policy);
  }
  return result;
}

module.exports = { polishMailboxReplyParagraphs };
