function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeClassifierText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isAutomatedCampaignReply(message) {
  const subject = normalizeClassifierText(message && message.subject);
  const preview = normalizeText(message && message.preview);
  const body = normalizeText(message && message.body);
  const content = normalizeClassifierText([
    preview ? getAuthoredMessageText(preview) : '',
    body ? getAuthoredMessageText(body) : '',
  ].filter(Boolean).join(' '));

  const automatedSubjectPatterns = [
    /^(?:(?:re|fw|fwd)\s*:\s*)*automatisch antwoord(?:en)?\b/,
    /\bautomatisch antwoord\b/,
    /\bautomatische (?:e-?mail|mail|reactie|ontvangstbevestiging)\b/,
    /\bontvangstbevestiging\b/,
    /\bautomatic (?:reply|response)\b/,
    /\bauto[ -]?reply\b/,
    /\bout[ -]?of[ -]?office\b/,
    /\bafwezigheid(?:sbericht|melding)?\b/,
    /\breturned mail\b/,
    /\bundeliverable\b/,
    /\bmail delivery (?:failure|failed)\b/,
    /\bdelivery status notification\b/,
    /^email received\b/,
    /^bericht ontvangen\b/,
    /\buw mail is ontvangen\b/,
    /\bbedankt voor (?:je|jouw|uw) (?:e-?mail|mail|bericht)\b/,
  ];
  const automatedContentPatterns = [
    /\bdit (?:bericht|e-mail|email) is automatisch gegenereerd\b/,
    /\bdit is (?:een )?automatisch(?:e)? (?:e-?mail|mail|bericht|antwoord|reactie|ontvangstbevestiging)\b/,
    /\bthis is an automated (?:e-?mail|mail|message|reply|response)\b/,
    /\bwe would like to acknowledge that we have received your request\b/,
    /\bis ons kantoor gesloten\b/,
    /\bop dit moment ben ik op vakantie\b/,
    /\bberichten worden (?:in deze periode )?niet gelezen\b/,
    /\bplease type your reply above this line\b/,
    /\buw aanvraag\s*\([^)]{1,40}\)\s+is ontvangen\b/,
    /\byour request\s*\([^)]{1,40}\)\s+has been received\b/,
    /\bwij streven ernaar om (?:je|jouw|uw) (?:vraag|bericht|e-?mail|mail) binnen \d+\s+(?:werk)?dag(?:en)? te beantwoorden\b/,
    /\bin deze periode beantwoorden wij geen (?:e-?mails?|mails?|berichten)\b/,
  ];

  return (
    automatedSubjectPatterns.some((pattern) => pattern.test(subject)) ||
    automatedContentPatterns.some((pattern) => pattern.test(content))
  );
}

module.exports = {
  isAutomatedCampaignReply,
  normalizeClassifierText,
};
const {
  getAuthoredMessageText,
} = require('./mailbox-image-ownership');
