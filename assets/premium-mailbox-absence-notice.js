(function (global) {
  'use strict';

  function isAbsenceNotice(value) {
    const text = String(value || '').trim().toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
    // Missing automatic headers are common in provider imports. Require both
    // absence and generic mailbox handling; a closure alone is not evidence.
    const unavailable = /\b(?:(?:de|onze|mijn|het|ons) (?:praktijk|kantoor|bedrijf|winkel|salon|team) (?:is|zijn)|(?:ik|wij|we) (?:ben|zijn))\s+(?:(?:momenteel|tijdelijk|op dit moment)\s+)?(?:gesloten|afwezig|niet (?:aanwezig|bereikbaar)|(?:met|op) vakantie)\b/.test(text) ||
      /\b(?:(?:i am|i'm|we are|we're)\s+(?:currently\s+)?(?:away|unavailable|on (?:holiday|vacation))|(?:the|our) (?:office|practice|business|shop) is (?:temporarily )?closed)\b/.test(text);
    const deferredMailbox = /\b(?:e-?mails?|mails?|berichten)\s+(?:wordt|worden)\s+(?:na (?:die|deze) tijd|na (?:mijn|onze) (?:terugkeer|vakantie)|na de (?:vakantie|sluiting)|daarna|vanaf\b[^.!?]{1,80})\s+(?:weer\s+)?(?:gelezen|beantwoord|behandeld)\b/.test(text) ||
      /\b(?:na (?:mijn|onze) (?:terugkeer|vakantie)|na de (?:vakantie|sluiting)|bij (?:mijn|onze) terugkomst)\b[^.!?]{0,100}\b(?:beantwoord|beantwoorden|lees|lezen|behandel|behandelen)\b[^.!?]{0,100}\b(?:e-?mails?|mails?|berichten)\b/.test(text) ||
      /\b(?:e-?mails?|mails?|berichten)\b[^.!?]{0,80}\b(?:niet|beperkt)\s+(?:gelezen|beantwoord|behandeld)\b/.test(text) ||
      /\b(?:reply|respond|answer)\b[^.!?]{0,100}\b(?:when|once|after|upon)\b[^.!?]{0,80}\b(?:return|back)\b/.test(text) ||
      /\b(?:e-?mails?|messages)\b[^.!?]{0,100}\b(?:not (?:be )?(?:read|monitored)|(?:answered|read) (?:after|upon))\b/.test(text);
    // Keep ambiguous messages with a question or specific feedback on our offer.
    const personalReply = text.replace(/https?:\/\/\S+/g, '').includes('?') ||
      /\b(?:je|jouw|uw|jullie|het|dit)\s+(?:ontwerp|webdesign|design|voorstel|aanbod|offerte)\b/.test(text) ||
      /\b(?:your|the|this)\s+(?:design|proposal|offer|quote|preview)\b/.test(text);
    return unavailable && deferredMailbox && !personalReply;
  }

  const api = Object.freeze({ isAbsenceNotice });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SoftoraMailboxAbsenceNotice = api;
})(typeof window !== 'undefined' ? window : globalThis);
