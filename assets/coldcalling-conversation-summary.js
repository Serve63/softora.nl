(function (root) {
  function normalizeFreeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeSearchText(value) {
    return normalizeFreeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function looksLikeConversationTranscript(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    const lower = normalizeSearchText(raw);
    if (/(^|\s)(user|bot|agent|klant)\s*:/.test(lower)) return true;
    if (raw.includes('|') && /(user|bot|agent|klant)\s*:/i.test(raw)) return true;
    if (raw.split(/\||\n/).length >= 4 && /(user|bot|agent|klant)\s*:/i.test(raw)) return true;
    return false;
  }

  function replaceGenericSoftoraSpeakerName(value) {
    return String(value || '')
      .replace(/\bde\s+agent van\s+softora\b/gi, 'Ruben Nijhuis van Softora')
      .replace(/\bsoftora[-\s]?agent\b/gi, 'Ruben Nijhuis van Softora')
      .replace(/\bde\s+agent\b/gi, 'Ruben Nijhuis')
      .replace(/\been\s+agent\b/gi, 'Ruben Nijhuis')
      .replace(/\bagent\b/gi, 'Ruben Nijhuis')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function stripConversationDialogueMarkers(value) {
    const stripped = String(value || '')
      .replace(/\s*\|\s*/g, ' ')
      .replace(/\b(user|bot|agent|klant)\s*:\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return replaceGenericSoftoraSpeakerName(stripped);
  }

  function stripActionableFollowUpSummarySentence(value) {
    return String(value || '')
      .replace(
        /\s*(?:De\s+)?(?:logische\s+)?vervolgstap(?:\s*:\s*|\s+is(?:\s+om)?\s+|\s+om\s+)[^.?!]*(?:[.?!]|$)/gi,
        ' '
      )
      .replace(
        /\s*(?:Aanbevolen|Beste|Volgende)\s+(?:vervolgstap|stap)(?:\s*:\s*|\s+is(?:\s+om)?\s+|\s+om\s+)[^.?!]*(?:[.?!]|$)/gi,
        ' '
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function sanitizeConversationSummaryCopy(value) {
    const stripped = stripConversationDialogueMarkers(value);
    return stripActionableFollowUpSummarySentence(stripped.replace(/\s*\n+\s*/g, ' ').trim());
  }

  function looksLikeDirectSpeechConversationSummary(value) {
    const raw = sanitizeConversationSummaryCopy(value);
    if (!raw) return false;
    const lower = raw.toLowerCase();
    if (/^(hallo|hoi|hey|goedemiddag|goedemorgen|goedenavond|met\s+\w+|ja[,\s]|nee[,\s]|oke?[,\s]|prima[,\s])/.test(lower)) {
      return true;
    }
    if (/\bje spreekt met\b|\bik bel je\b|\bkan ik\b|\bweet je wat we doen\b|\bik wil graag meteen\b/i.test(raw)) {
      return true;
    }
    const questionCount = (raw.match(/\?/g) || []).length;
    const commaCount = (raw.match(/,/g) || []).length;
    return questionCount >= 1 && commaCount >= 3 && raw.length >= 140;
  }

  function looksLikeAbruptConversationSummary(value) {
    const raw = sanitizeConversationSummaryCopy(value);
    if (!raw) return false;
    return /(\.\.\.|\u2026)$/.test(raw);
  }

  function looksMixedLanguageConversationSummary(value) {
    const normalized = sanitizeConversationSummaryCopy(value).toLowerCase();
    if (!normalized) return false;
    const strongMatches =
      (
        normalized.match(
          /\b(the|call|conversation|agent|user|brief|outbound|inbound|ended|shortly|mentioned|during|standards|expectations|activities|interaction|follow-up|meeting|appointment|summary|details)\b/g
        ) || []
      ).length;
    const mildMatches = (normalized.match(/\b(was|were|is|are|had|with|after|before|where|for)\b/g) || []).length;
    return strongMatches >= 2 || (strongMatches >= 1 && mildMatches >= 3) || mildMatches >= 6;
  }

  function looksLikeAgendaConfirmationSummary(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(^op \d{4}-\d{2}-\d{2}\b|^namens\b|afspraak ingepland|bevestigingsbericht|definitieve bevestiging|twee collega|langskomen|volgactie|bevestigingsmail sturen|stuur(?:\s+\w+){0,3}\s+bevestigingsmail|gedetecteerde afspraak|afspraakbevestiging|agenda-item)/.test(
      text
    );
  }

  function isGenericConversationPlaceholder(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return (
      text === 'nog geen gesprekssamenvatting beschikbaar.' ||
      text === 'samenvatting volgt na verwerking van het gesprek.' ||
      text === 'samenvatting wordt opgesteld op basis van de transcriptie.'
    );
  }

  function pickReadableConversationSummary() {
    const candidates = Array.from(arguments);
    for (const candidate of candidates) {
      const raw = String(candidate || '').trim();
      if (!raw) continue;
      if (isGenericConversationPlaceholder(raw)) continue;
      if (looksLikeConversationTranscript(raw)) continue;
      const cleaned = sanitizeConversationSummaryCopy(raw);
      if (isGenericConversationPlaceholder(cleaned)) continue;
      if (looksLikeAgendaConfirmationSummary(cleaned)) continue;
      if (looksMixedLanguageConversationSummary(cleaned)) continue;
      if (looksLikeDirectSpeechConversationSummary(cleaned)) continue;
      if (looksLikeAbruptConversationSummary(cleaned)) continue;
      if (cleaned) return cleaned;
    }
    return '';
  }

  function isAbortLikeLoadError(error) {
    const text = normalizeSearchText(error?.message || error || '');
    return /abort|aborted|signal is aborted/.test(text);
  }

  async function summarizeConversationTextNl(text, options = {}) {
    if (!root.SoftoraAI || typeof root.SoftoraAI.summarizeText !== 'function') return '';
    const payload = {
      text: String(text || ''),
      style: options.style || 'medium',
      language: 'nl',
      maxSentences: Number(options.maxSentences || 4),
      extraInstructions: String(options.extraInstructions || ''),
    };
    const result = await root.SoftoraAI.summarizeText(payload);
    return String(result?.summary || '').trim();
  }

  function createSharedCallSummaryAccessors(cacheInput) {
    const cache = cacheInput && typeof cacheInput === 'object' ? cacheInput : Object.create(null);

    function getSharedCallSummary(callId) {
      const normalizedCallId = normalizeFreeText(callId);
      if (!normalizedCallId) return '';
      const summary = String(cache?.[normalizedCallId] || '').trim();
      const cleanedSummary = pickReadableConversationSummary(summary);
      if (!cleanedSummary || looksLikeAgendaConfirmationSummary(cleanedSummary)) {
        if (summary) {
          delete cache[normalizedCallId];
        }
        return '';
      }
      return cleanedSummary;
    }

    function setSharedCallSummary(callId, summary) {
      const normalizedCallId = normalizeFreeText(callId);
      const normalizedSummary = pickReadableConversationSummary(summary);
      if (
        !normalizedCallId ||
        !normalizedSummary ||
        isGenericConversationPlaceholder(normalizedSummary) ||
        looksLikeAgendaConfirmationSummary(normalizedSummary)
      ) {
        return;
      }
      if (String(cache?.[normalizedCallId] || '').trim() === normalizedSummary) return;
      cache[normalizedCallId] = normalizedSummary;
    }

    return {
      getSharedCallSummary,
      setSharedCallSummary,
    };
  }

  const api = {
    normalizeFreeText,
    normalizeSearchText,
    looksLikeConversationTranscript,
    replaceGenericSoftoraSpeakerName,
    stripConversationDialogueMarkers,
    stripActionableFollowUpSummarySentence,
    sanitizeConversationSummaryCopy,
    looksLikeDirectSpeechConversationSummary,
    looksLikeAbruptConversationSummary,
    looksMixedLanguageConversationSummary,
    pickReadableConversationSummary,
    isAbortLikeLoadError,
    looksLikeAgendaConfirmationSummary,
    isGenericConversationPlaceholder,
    summarizeConversationTextNl,
    createSharedCallSummaryAccessors,
  };

  root.SoftoraColdcallingConversationSummary = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
