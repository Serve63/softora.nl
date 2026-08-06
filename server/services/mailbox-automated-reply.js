const { getAuthoredMessageText } = require('./mailbox-image-ownership');

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

function buildAutomatedReplyEvidence(values = {}) {
  const autoSubmitted = normalizeText(values.autoSubmitted);
  const precedence = normalizeText(values.precedence);
  const autoResponseSuppress = normalizeText(values.autoResponseSuppress);
  return {
    autoSubmitted,
    precedence,
    autoResponseSuppress,
    automatedReplyEvidence: Boolean(
      (autoSubmitted && normalizeClassifierText(autoSubmitted) !== 'no') ||
      /^(?:auto_reply|auto-reply|bulk|junk|list)$/i.test(precedence) ||
      autoResponseSuppress
    ),
  };
}

function isAutomatedCampaignReply(message) {
  const subject = normalizeClassifierText(message && message.subject);
  const preview = normalizeText(message && message.preview);
  const body = normalizeText(message && message.body);
  const content = normalizeClassifierText([
    preview ? getAuthoredMessageText(preview) : '',
    body ? getAuthoredMessageText(body) : '',
  ].filter(Boolean).join(' '));
  const autoSubmitted = normalizeClassifierText(message && message.autoSubmitted);
  const precedence = normalizeClassifierText(message && message.precedence);
  const autoResponseSuppress = normalizeClassifierText(message && message.autoResponseSuppress);
  const provenAutomaticHeader = Boolean(
    message && message.automatedReplyEvidence === true ||
    (autoSubmitted && autoSubmitted !== 'no') ||
    /^(?:auto_reply|auto-reply|bulk|junk|list)$/.test(precedence) ||
    autoResponseSuppress
  );

  const automatedSubjectPatterns = [
    /^(?:(?:re|fw|fwd)\s*:\s*)*automatisch antwoord(?:en)?\b/,
    /^(?:(?:re|fw|fwd)\s*:\s*)*(?:zomer|winter|vakantie|kerst|feestdagen?|bouwvak)[ -]?sluiting\b/,
    /\bautomatisch antwoord\b/,
    /\bautomatische (?:e-?mail|mail|reactie|ontvangstbevestiging)\b/,
    /\bontvangstbevestiging\b/,
    /\bautomatic (?:reply|response)\b/,
    /\bauto[ -]?reply\b/,
    /\bout[ -]?of[ -]?office\b/,
    /\bafwezigheid(?:sbericht|melding)?\b/,
    /^(?:niet aanwezig|afwezig)(?:\s+tot\b[^:\n]{0,80})?\s+(?:(?:re|fw|fwd)\s*:\s*)+/,
    /\breturned mail\b/,
    /\bundeliverable\b/,
    /\bmail delivery (?:failure|failed)\b/,
    /\bdelivery status notification\b/,
    /^email received\b/,
    /^bericht ontvangen\b/,
    /\buw mail is ontvangen\b/,
    /^bedankt voor (?:je|jouw|uw) (?:mail|bericht)!?\s+(?:re|fw|fwd)\s*:/,
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
    /\b(?:we|wij) streven ernaar (?:jouw|je|uw) (?:e-?mail|mail|bericht) (?:de )?(?:eerstvolgende|volgende) werkdag te beantwoorden\b/,
    /\b(?:bedankt|dank) voor (?:je|jouw|uw) bericht\b[\s\S]{0,220}\b(?:eerstvolgende werkdag|zo snel mogelijk) te beantwoorden\b/,
    /\b(?:ik ben|wij zijn|ons kantoor is) (?:momenteel|op dit moment|tijdelijk)?\s*(?:afwezig|gesloten|niet aanwezig)\b/,
    /\b(?:momenteel|op dit moment)\s+(?:heb ik|hebben wij)\s+vakantie\b[\s\S]{0,240}\b(?:e-?mail|mail)\b[\s\S]{0,160}\b(?:minder vaak|niet|beperkt)\b/,
    /\bwelkom bij\b[\s\S]{0,240}\bals u\b[\s\S]{0,180}\bnaar whatsapp stuurt\b[\s\S]{0,180}\b(?:richtprijs|offerte)\b/,
    /\b(?:i am|we are) (?:currently )?out of (?:the )?office\b/,
  ];

  return (
    provenAutomaticHeader ||
    automatedSubjectPatterns.some((pattern) => pattern.test(subject)) ||
    automatedContentPatterns.some((pattern) => pattern.test(content))
  );
}

module.exports = {
  buildAutomatedReplyEvidence,
  isAutomatedCampaignReply,
  normalizeClassifierText,
};
