function createAgendaLeadDetailService(deps = {}) {
  const {
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    openAiTranscriptionModel = '',
    openAiAudioTranscriptionModel = '',
    publicBaseUrl = '',
    recentWebhookEvents = [],
    recentCallUpdates = [],
    transcriptionPromiseByCallId = new Map(),
    aiCallInsightsByCallId = new Map(),
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    sanitizeAppointmentLocation = (value) => String(value || '').trim(),
    sanitizeAppointmentWhatsappInfo = (value) => String(value || '').trim(),
    resolveAppointmentCallId = () => '',
    getLatestCallUpdateByCallId = () => null,
    resolvePreferredRecordingUrl = () => '',
    normalizeAbsoluteHttpUrl = (value) => String(value || '').trim(),
    inferCallProvider = () => 'retell',
    isTwilioStatusApiConfigured = () => false,
    fetchTwilioRecordingsByCallId = async () => ({ recordings: [] }),
    choosePreferredTwilioRecording = () => null,
    buildTwilioRecordingMediaUrl = () => '',
    fetchBinaryWithTimeout = async () => ({
      response: { ok: false, status: 500, headers: { get: () => '' } },
      bytes: Buffer.alloc(0),
    }),
    getTwilioBasicAuthorizationHeader = () => '',
    parseJsonLoose = () => null,
    getOpenAiApiKey = () => '',
    fetchImpl = fetch,
    upsertRecentCallUpdate = () => null,
    ensureRuleBasedInsightAndAppointment = () => null,
    maybeAnalyzeCallUpdateWithAi = async () => null,
    summaryContainsEnglishMarkers = () => false,
    generateTextSummaryWithAi = async () => ({ summary: '' }),
    resolveCallDurationSeconds = () => null,
    findInterestedLeadRowByCallId = () => null,
    extractTranscriptFull = () => '',
    extractTwilioRecordingSidFromUrl = () => '',
    logger = console,
  } = deps;

  function findTranscriptFromWebhookEvents(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return '';
    for (const event of recentWebhookEvents) {
      if (normalizeString(event?.callId) !== normalizedCallId) continue;
      const text = extractTranscriptFull(event.payload);
      if (text) return text;
    }
    return '';
  }

  function getAppointmentTranscriptText(appointment) {
    if (!appointment) return '';
    const storedTranscript = normalizeString(
      appointment?.leadConversationTranscript || appointment?.leadConversationTranscriptFull || ''
    );
    if (storedTranscript) return storedTranscript;
    const callId = resolveAppointmentCallId(appointment);
    const fromCallUpdate = getLatestCallUpdateByCallId(callId);
    const transcript = normalizeString(
      fromCallUpdate?.transcriptFull || fromCallUpdate?.transcriptSnippet || ''
    );
    if (transcript) return transcript;
    const fromEvents = findTranscriptFromWebhookEvents(callId);
    if (fromEvents) return fromEvents;
    return '';
  }

  function looksLikeAgendaConfirmationSummary(value) {
    const text = normalizeString(value || '').toLowerCase();
    if (!text) return false;
    return /(^op \d{4}-\d{2}-\d{2}\b|^namens\b|afspraak ingepland|bevestigingsbericht|definitieve bevestiging|twee collega|langskomen|volgactie|controleer de gegevens en zet daarna de afspraak in de agenda)/.test(
      text
    );
  }

  function isGenericConversationSummaryPlaceholder(value) {
    const text = normalizeString(value || '').toLowerCase();
    if (!text) return false;
    return (
      text === 'nog geen gesprekssamenvatting beschikbaar.' ||
      text === 'samenvatting volgt na verwerking van het gesprek.'
    );
  }

  function sanitizeConversationSummaryText(value) {
    return normalizeString(value || '')
      .replace(/\s*\|\s*/g, ' ')
      .replace(/\b(user|bot|agent|klant)\s*:\s*/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function looksLikeDirectSpeechConversationSummaryText(value) {
    const raw = sanitizeConversationSummaryText(value);
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

  function looksLikeAbruptConversationSummaryText(value) {
    const raw = sanitizeConversationSummaryText(value);
    if (!raw) return false;
    return /(\.\.\.|…)$/.test(raw);
  }

  function pickReadableConversationSummaryForLeadDetail(...candidates) {
    for (const candidate of candidates) {
      const cleaned = sanitizeConversationSummaryText(candidate);
      if (!cleaned) continue;
      if (isGenericConversationSummaryPlaceholder(cleaned)) continue;
      if (looksLikeAgendaConfirmationSummary(cleaned)) continue;
      if (summaryContainsEnglishMarkers(cleaned)) continue;
      if (looksLikeDirectSpeechConversationSummaryText(cleaned)) continue;
      if (looksLikeAbruptConversationSummaryText(cleaned)) continue;
      return truncateText(cleaned, 4000);
    }
    return '';
  }

  function inferAudioFileExtension(contentType = '', sourceUrl = '') {
    const normalizedType = normalizeString(contentType).toLowerCase();
    if (normalizedType.includes('mpeg') || normalizedType.includes('mp3')) return 'mp3';
    if (normalizedType.includes('mp4') || normalizedType.includes('m4a')) return 'm4a';
    if (normalizedType.includes('wav') || normalizedType.includes('x-wav')) return 'wav';
    if (normalizedType.includes('webm')) return 'webm';
    if (normalizedType.includes('ogg')) return 'ogg';
    if (normalizedType.includes('flac')) return 'flac';

    const normalizedUrl = normalizeString(sourceUrl);
    const match = normalizedUrl.match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i);
    const ext = normalizeString(match?.[1] || '').toLowerCase();
    if (/^(mp3|m4a|wav|webm|ogg|flac)$/.test(ext)) return ext;
    return 'mp3';
  }

  function buildRecordingFileNameForTranscription(callId, contentType = '', sourceUrl = '') {
    const safeCallId =
      normalizeString(callId).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'call';
    const ext = inferAudioFileExtension(contentType, sourceUrl);
    return `${safeCallId}.${ext}`;
  }

  function getOpenAiTranscriptionModelCandidates() {
    const configured = normalizeString(openAiTranscriptionModel || openAiAudioTranscriptionModel || '');
    const models = [];
    if (configured) models.push(configured);
    ['gpt-4o-transcribe', 'whisper-1'].forEach((candidate) => {
      if (!models.includes(candidate)) models.push(candidate);
    });
    return models;
  }

  async function fetchCallRecordingForLeadDetail(callId, callUpdate, interestedLead, aiInsight) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;

    const sources = [callUpdate, interestedLead, aiInsight].filter(
      (item) => item && typeof item === 'object'
    );
    const recordingUrl = resolvePreferredRecordingUrl(
      callUpdate,
      interestedLead,
      aiInsight,
      {
        callId: normalizedCallId,
        provider: normalizeString(callUpdate?.provider || interestedLead?.provider || ''),
      }
    );

    let recordingSid = '';
    for (const source of sources) {
      recordingSid =
        recordingSid ||
        normalizeString(source?.recordingSid || source?.recording_sid || '') ||
        extractTwilioRecordingSidFromUrl(
          source?.recordingUrl ||
            source?.recording_url ||
            source?.recordingUrlProxy ||
            source?.audioUrl ||
            source?.audio_url ||
            ''
        );
    }

    const providerHint = normalizeString(
      callUpdate?.provider || interestedLead?.provider || aiInsight?.provider || ''
    );
    const provider = inferCallProvider(normalizedCallId, providerHint || 'retell');
    const hasTwilioProxyReference = /\/api\/coldcalling\/recording-proxy/i.test(recordingUrl);

    if ((provider === 'twilio' || recordingSid || hasTwilioProxyReference) && isTwilioStatusApiConfigured()) {
      try {
        if (!recordingSid) {
          const { recordings } = await fetchTwilioRecordingsByCallId(normalizedCallId);
          const preferred = choosePreferredTwilioRecording(recordings);
          recordingSid = normalizeString(preferred?.sid || '');
        }

        if (recordingSid) {
          const mediaUrl = buildTwilioRecordingMediaUrl(recordingSid);
          if (mediaUrl) {
            const { response, bytes } = await fetchBinaryWithTimeout(
              mediaUrl,
              {
                method: 'GET',
                headers: {
                  Authorization: getTwilioBasicAuthorizationHeader(),
                },
              },
              30000
            );

            if (!response.ok) {
              const err = new Error(`Twilio opname ophalen mislukt (${response.status}).`);
              err.status = response.status;
              throw err;
            }

            const contentType = normalizeString(response.headers.get('content-type') || '') || 'audio/mpeg';
            return {
              bytes,
              contentType,
              sourceUrl: mediaUrl.toString(),
              fileName: buildRecordingFileNameForTranscription(
                normalizedCallId || recordingSid,
                contentType,
                mediaUrl.toString()
              ),
            };
          }
        }
      } catch (_error) {
        // Fall through to other recording URLs when direct Twilio fetch fails.
      }
    }

    const absoluteRecordingUrl =
      normalizeAbsoluteHttpUrl(recordingUrl) ||
      (recordingUrl.startsWith('/') && normalizeAbsoluteHttpUrl(publicBaseUrl)
        ? new URL(recordingUrl, normalizeAbsoluteHttpUrl(publicBaseUrl)).toString()
        : '');
    if (!absoluteRecordingUrl) return null;

    const { response, bytes } = await fetchBinaryWithTimeout(
      absoluteRecordingUrl,
      {
        method: 'GET',
      },
      30000
    );
    if (!response.ok) {
      const err = new Error(`Opname ophalen mislukt (${response.status}).`);
      err.status = response.status;
      throw err;
    }

    const contentType = normalizeString(response.headers.get('content-type') || '') || 'audio/mpeg';
    return {
      bytes,
      contentType,
      sourceUrl: absoluteRecordingUrl,
      fileName: buildRecordingFileNameForTranscription(
        normalizedCallId,
        contentType,
        absoluteRecordingUrl
      ),
    };
  }

  async function transcribeCallRecordingForLeadDetail(callId, callUpdate, interestedLead, aiInsight) {
    const apiKey = getOpenAiApiKey();
    const normalizedCallId = normalizeString(callId);
    if (!apiKey || !normalizedCallId) return '';

    const recording = await fetchCallRecordingForLeadDetail(
      normalizedCallId,
      callUpdate,
      interestedLead,
      aiInsight
    );
    if (!recording?.bytes || recording.bytes.length === 0) return '';
    if (recording.bytes.length > 24 * 1024 * 1024) {
      throw new Error('Opname is te groot om direct te transcriberen.');
    }

    const models = getOpenAiTranscriptionModelCandidates();
    let lastError = null;

    for (const model of models) {
      try {
        const form = new FormData();
        form.append(
          'file',
          new Blob([recording.bytes], { type: recording.contentType || 'audio/mpeg' }),
          recording.fileName ||
            buildRecordingFileNameForTranscription(
              normalizedCallId,
              recording.contentType,
              recording.sourceUrl
            )
        );
        form.append('model', model);
        form.append('language', 'nl');
        form.append('temperature', '0');
        form.append('response_format', 'text');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);

        try {
          const response = await fetchImpl(`${openAiApiBaseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            body: form,
            signal: controller.signal,
          });

          const rawBody = await response.text();
          if (!response.ok) {
            const err = new Error(`OpenAI transcriptie mislukt (${response.status})`);
            err.status = response.status;
            err.data = parseJsonLoose(rawBody) || rawBody;
            throw err;
          }

          const parsed = parseJsonLoose(rawBody);
          const transcriptText =
            normalizeString(parsed?.text || parsed?.transcript || parsed?.output_text || '') ||
            normalizeString(rawBody);
          if (transcriptText) {
            return truncateText(transcriptText, 9000);
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    return '';
  }

  async function ensureTranscriptHydratedForLeadDetail(callId, callUpdate, interestedLead, aiInsight) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) {
      return { callUpdate, aiInsight, transcript: '' };
    }

    const existingTranscript =
      normalizeString(callUpdate?.transcriptFull || callUpdate?.transcriptSnippet || '') ||
      findTranscriptFromWebhookEvents(normalizedCallId) ||
      '';
    if (existingTranscript) {
      return { callUpdate, aiInsight, transcript: existingTranscript };
    }

    const existingPromise = transcriptionPromiseByCallId.get(normalizedCallId);
    if (existingPromise) return existingPromise;

    const run = (async () => {
      try {
        const transcript = await transcribeCallRecordingForLeadDetail(
          normalizedCallId,
          callUpdate,
          interestedLead,
          aiInsight
        );
        if (!transcript) {
          return { callUpdate, aiInsight, transcript: '' };
        }

        const provider =
          normalizeString(callUpdate?.provider || interestedLead?.provider || '') ||
          inferCallProvider(normalizedCallId, 'retell');
        const recordingUrl = resolvePreferredRecordingUrl(
          callUpdate,
          interestedLead,
          aiInsight,
          { callId: normalizedCallId, provider }
        );
        const nextUpdate = upsertRecentCallUpdate(
          {
            ...(callUpdate && typeof callUpdate === 'object' ? callUpdate : {}),
            callId: normalizedCallId,
            phone: normalizeString(
              callUpdate?.phone || interestedLead?.phone || aiInsight?.phone || ''
            ),
            company:
              normalizeString(
                callUpdate?.company ||
                  interestedLead?.company ||
                  aiInsight?.company ||
                  aiInsight?.leadCompany ||
                  ''
              ) || '',
            name:
              normalizeString(
                callUpdate?.name ||
                  interestedLead?.contact ||
                  aiInsight?.contactName ||
                  aiInsight?.leadName ||
                  ''
              ) || '',
            provider,
            messageType: normalizeString(callUpdate?.messageType || 'audio.transcription'),
            transcriptFull: transcript,
            transcriptSnippet: truncateText(transcript.replace(/\s+/g, ' '), 450),
            recordingUrl: normalizeString(recordingUrl || callUpdate?.recordingUrl || ''),
            updatedAt: new Date().toISOString(),
            updatedAtMs: Date.now(),
          },
          {
            persistReason: 'call_audio_transcription',
          }
        );

        let nextInsight =
          ensureRuleBasedInsightAndAppointment(nextUpdate) ||
          aiCallInsightsByCallId.get(normalizedCallId) ||
          aiInsight ||
          null;

        try {
          const analyzedInsight = await maybeAnalyzeCallUpdateWithAi(nextUpdate);
          if (analyzedInsight) nextInsight = analyzedInsight;
        } catch (error) {
          logger.warn?.(
            '[Call Recording AI Analyze Failed]',
            JSON.stringify(
              {
                callId: normalizedCallId,
                message: error?.message || 'Onbekende fout',
                status: error?.status || null,
              },
              null,
              2
            )
          );
        }

        return {
          callUpdate: nextUpdate,
          aiInsight: nextInsight,
          transcript,
        };
      } catch (error) {
        logger.warn?.(
          '[Call Recording Transcription Failed]',
          JSON.stringify(
            {
              callId: normalizedCallId,
              message: error?.message || 'Onbekende fout',
              status: error?.status || null,
            },
            null,
            2
          )
        );
        return { callUpdate, aiInsight, transcript: '' };
      }
    })().finally(() => {
      transcriptionPromiseByCallId.delete(normalizedCallId);
    });

    transcriptionPromiseByCallId.set(normalizedCallId, run);
    return run;
  }

  async function buildConversationSummaryForLeadDetail(
    callUpdate,
    aiInsight,
    interestedLead,
    transcriptText = ''
  ) {
    const transcript = normalizeString(transcriptText || '');
    const transcriptSnippet = normalizeString(callUpdate?.transcriptSnippet || '');
    const callSummary = normalizeString(callUpdate?.summary || '');
    const aiSummary = normalizeString(aiInsight?.summary || '');
    const interestedSummary = normalizeString(interestedLead?.summary || '');
    const followUpReason = normalizeString(
      aiInsight?.followUpReason || interestedLead?.whatsappInfo || ''
    );

    const fallbackSummary = pickReadableConversationSummaryForLeadDetail(
      callSummary,
      aiSummary,
      transcriptSnippet,
      interestedSummary,
      followUpReason
    );

    const sourceText = [
      transcript ? `Transcript van het gesprek:\n${truncateText(transcript, 9000)}` : '',
      transcriptSnippet && transcriptSnippet !== transcript
        ? `Korte transcript-snippet:\n${truncateText(transcriptSnippet, 1200)}`
        : '',
      callSummary ? `Bestaande call-samenvatting:\n${truncateText(callSummary, 1800)}` : '',
      aiSummary ? `Bestaande AI-samenvatting:\n${truncateText(aiSummary, 1800)}` : '',
      interestedSummary && interestedSummary !== callSummary && interestedSummary !== aiSummary
        ? `Aanvullende context:\n${truncateText(interestedSummary, 900)}`
        : '',
      followUpReason ? `Vervolgactie of context:\n${truncateText(followUpReason, 900)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const needsAiRewrite =
      Boolean(sourceText) &&
      (!fallbackSummary ||
        fallbackSummary.length < 220 ||
        summaryContainsEnglishMarkers(fallbackSummary) ||
        looksLikeDirectSpeechConversationSummaryText(fallbackSummary) ||
        looksLikeAbruptConversationSummaryText(fallbackSummary));

    if (needsAiRewrite && getOpenAiApiKey()) {
      try {
        const result = await generateTextSummaryWithAi({
          text: sourceText,
          style: 'medium',
          language: 'nl',
          maxSentences: 4,
          extraInstructions: [
            'Maak een korte maar inhoudelijke belnotitie voor Softora die samenvat waar het gesprek over ging.',
            'Schrijf in de derde persoon, bijvoorbeeld: "De prospect gaf aan..." of "Meneer/mevrouw X gaf aan...".',
            'Benoem de behoefte of vraag van de prospect, de reactie van de prospect en eventuele bezwaren of context.',
            'Noem alleen aan het einde een vervolgstap als die echt in het gesprek naar voren kwam; vermijd exacte zinsneden als "afspraak ingepland" of "afspraak is ingepland".',
            'Schrijf nadrukkelijk niet als agenda-item, afspraakbevestiging of bevestigingsbericht.',
            'Gebruik geen koppen, bullets, citaten of labels zoals user:, bot:, agent: of klant:.',
            'Eindig altijd met volledige zinnen en nooit met ellips of afgebroken tekst.',
          ].join(' '),
        });
        const rewrittenSummary = normalizeString(result?.summary || '');
        if (
          rewrittenSummary &&
          !isGenericConversationSummaryPlaceholder(rewrittenSummary) &&
          !summaryContainsEnglishMarkers(rewrittenSummary) &&
          !looksLikeDirectSpeechConversationSummaryText(rewrittenSummary) &&
          !looksLikeAbruptConversationSummaryText(rewrittenSummary)
        ) {
          return rewrittenSummary;
        }
      } catch (_error) {
        // Fall back to available local sources.
      }
    }

    if (fallbackSummary) return fallbackSummary;

    const transcriptFallback = sanitizeConversationSummaryText(transcriptSnippet || transcript);
    if (
      transcriptFallback &&
      !looksLikeDirectSpeechConversationSummaryText(transcriptFallback) &&
      !looksLikeAbruptConversationSummaryText(transcriptFallback)
    ) {
      return truncateText(transcriptFallback, 4000);
    }

    return '';
  }

  async function buildCallBackedLeadDetail(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;

    let callUpdate = getLatestCallUpdateByCallId(normalizedCallId);
    const interestedLead = findInterestedLeadRowByCallId(normalizedCallId);
    let aiInsight = aiCallInsightsByCallId.get(normalizedCallId) || null;

    if (!callUpdate && !interestedLead && !aiInsight) return null;

    if (!aiInsight && callUpdate) {
      aiInsight =
        ensureRuleBasedInsightAndAppointment(callUpdate) ||
        aiCallInsightsByCallId.get(normalizedCallId) ||
        null;
    }

    let transcript =
      normalizeString(callUpdate?.transcriptFull || callUpdate?.transcriptSnippet || '') ||
      findTranscriptFromWebhookEvents(normalizedCallId) ||
      '';

    const existingReadableSummary = pickReadableConversationSummaryForLeadDetail(
      callUpdate?.summary,
      aiInsight?.summary,
      interestedLead?.summary,
      aiInsight?.followUpReason
    );
    const shouldHydrateTranscript =
      !transcript &&
      Boolean(resolvePreferredRecordingUrl(callUpdate, interestedLead, aiInsight)) &&
      (!existingReadableSummary || existingReadableSummary.length < 220);

    if (shouldHydrateTranscript) {
      const hydrated = await ensureTranscriptHydratedForLeadDetail(
        normalizedCallId,
        callUpdate,
        interestedLead,
        aiInsight
      );
      if (hydrated?.callUpdate) callUpdate = hydrated.callUpdate;
      if (hydrated?.aiInsight) aiInsight = hydrated.aiInsight;
      transcript =
        normalizeString(
          hydrated?.transcript || callUpdate?.transcriptFull || callUpdate?.transcriptSnippet || ''
        ) ||
        findTranscriptFromWebhookEvents(normalizedCallId) ||
        '';
    }

    const summary = await buildConversationSummaryForLeadDetail(
      callUpdate,
      aiInsight,
      interestedLead,
      transcript
    );
    const recordingUrl = resolvePreferredRecordingUrl(
      callUpdate,
      interestedLead,
      { callId: normalizedCallId, provider: normalizeString(callUpdate?.provider || interestedLead?.provider || '') }
    );

    return {
      callId: normalizedCallId,
      company:
        normalizeString(
          callUpdate?.company ||
            interestedLead?.company ||
            aiInsight?.company ||
            aiInsight?.leadCompany ||
            ''
        ) || 'Onbekende lead',
      contact:
        normalizeString(
          callUpdate?.name ||
            interestedLead?.contact ||
            aiInsight?.contactName ||
            aiInsight?.leadName ||
            ''
        ) || 'Onbekend',
      phone: normalizeString(callUpdate?.phone || interestedLead?.phone || aiInsight?.phone || ''),
      date: normalizeDateYyyyMmDd(interestedLead?.date || ''),
      time: normalizeTimeHhMm(interestedLead?.time || ''),
      location: sanitizeAppointmentLocation(interestedLead?.location || ''),
      whatsappInfo: sanitizeAppointmentWhatsappInfo(interestedLead?.whatsappInfo || ''),
      summary: truncateText(normalizeString(summary || ''), 4000),
      callSummary: truncateText(normalizeString(callUpdate?.summary || ''), 1800),
      aiSummary: truncateText(normalizeString(aiInsight?.summary || ''), 1800),
      followUpReason: truncateText(
        normalizeString(aiInsight?.followUpReason || interestedLead?.whatsappInfo || ''),
        900
      ),
      transcriptSnippet: truncateText(
        normalizeString(callUpdate?.transcriptSnippet || transcript),
        1200
      ),
      transcript: truncateText(normalizeString(transcript), 9000),
      recordingUrl: normalizeString(recordingUrl || ''),
      recordingUrlAvailable: Boolean(normalizeString(recordingUrl || '')),
      durationSeconds: resolveCallDurationSeconds(callUpdate, interestedLead, aiInsight),
      provider: normalizeString(callUpdate?.provider || interestedLead?.provider || ''),
      updatedAt:
        normalizeString(callUpdate?.updatedAt || aiInsight?.analyzedAt || interestedLead?.createdAt || '') ||
        new Date().toISOString(),
    };
  }

  return {
    buildCallBackedLeadDetail,
    buildConversationSummaryForLeadDetail,
    buildRecordingFileNameForTranscription,
    getAppointmentTranscriptText,
    getOpenAiTranscriptionModelCandidates,
    pickReadableConversationSummaryForLeadDetail,
  };
}

module.exports = {
  createAgendaLeadDetailService,
};
