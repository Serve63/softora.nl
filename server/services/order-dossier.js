function createOrderDossierHelpers(deps = {}) {
  const {
    parseIntSafe = (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    normalizeString = (value) => String(value || '').trim(),
    clipText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    escapeHtml = (value) =>
      String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
  } = deps;

  function buildOrderDossierInput(options = {}) {
    const orderIdRaw = parseIntSafe(options.orderId, 0);
    const orderId = Number.isFinite(orderIdRaw) && orderIdRaw > 0 ? orderIdRaw : 0;
    const language = normalizeString(options.language || 'nl') || 'nl';
    const title = clipText(normalizeString(options.title || ''), 180);
    const company = clipText(normalizeString(options.company || ''), 180);
    const contact = clipText(normalizeString(options.contact || ''), 180);
    const domainName = clipText(normalizeString(options.domainName || ''), 180);
    const deliveryTime = clipText(normalizeString(options.deliveryTime || ''), 180);
    const claimedBy = clipText(normalizeString(options.claimedBy || ''), 120);
    const claimedAt = clipText(normalizeString(options.claimedAt || ''), 120);
    const description = clipText(normalizeString(options.description || ''), 7000);
    const transcript = clipText(normalizeString(options.transcript || ''), 7000);
    const sourceAppointmentLabel = clipText(
      normalizeString(options.sourceAppointmentLabel || ''),
      260
    );

    return {
      orderId,
      language,
      title: title || (orderId ? `Opdracht #${orderId}` : 'Opdracht'),
      company: company || 'Onbekend',
      contact,
      domainName,
      deliveryTime,
      claimedBy,
      claimedAt,
      description,
      transcript,
      sourceAppointmentLabel,
    };
  }

  function buildOrderDossierNarrative(input) {
    const description = normalizeString(input?.description || '');
    const transcript = normalizeString(input?.transcript || '');
    const chunks = [description];

    if (transcript) {
      if (description) {
        chunks.push(`Aanvullende gespreksnotities: ${transcript}`);
      } else {
        chunks.push(transcript);
      }
    }

    const merged = chunks
      .filter(Boolean)
      .join('\n\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (merged) return clipText(merged, 5000);
    return 'Nog geen uitgebreide klantwensen vastgelegd. Neem direct contact op met de klant om ontbrekende details te verzamelen.';
  }

  function buildShortOrderDossierOpusPrompt(options = {}) {
    void options;
    return 'Werk deze opdracht in Claude Opus 4.6 uit op basis van uitsluitend de gekoppelde lead- en dossierinformatie.';
  }

  function normalizeOrderDossierBlockTitle(value) {
    return normalizeString(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function shouldHideOrderDossierBlockTitle(value) {
    const normalized = normalizeOrderDossierBlockTitle(value);
    if (!normalized) return false;
    return normalized === 'uitvoerplan' ||
      normalized === 'uitvoerfocus' ||
      normalized.startsWith('ontbrekende informatie') ||
      normalized.startsWith('praktische aandachtspunten');
  }

  function normalizeOrderDossierPairLabel(value) {
    const label = normalizeString(value || '').replace(/\s+/g, ' ').trim();
    if (!label) return '';
    const normalized = label
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      normalized === 'accounthouder softora' ||
      normalized === 'softora contactpersoon'
    ) {
      return '';
    }
    return normalized === 'geclaimd door' ? 'Aangewezen aan' : label;
  }

  function buildOrderDossierFallbackLayout(options = {}) {
    const input = buildOrderDossierInput(options);
    const narrative = buildOrderDossierNarrative(input);
    const promptText = buildShortOrderDossierOpusPrompt(input);

    return {
      documentTitle: input.title || (input.orderId ? `Opdracht #${input.orderId}` : 'Opdracht'),
      subtitle:
        'Dynamisch uitvoerdossier op basis van actuele opdrachtinformatie en klantwensen.',
      opusPrompt: clipText(promptText, 20000),
      blocks: [
        {
          kind: 'meta',
          title: 'Projectkern',
          pairs: [
            { label: 'Bedrijf', value: input.company || '—' },
            { label: 'Contactpersoon', value: input.contact || '—' },
            { label: 'Domein', value: input.domainName || '—' },
            { label: 'Oplevertijd', value: input.deliveryTime || '—' },
            { label: 'Aangewezen aan', value: input.claimedBy || '—' },
            { label: 'Geclaimd op', value: input.claimedAt || '—' },
          ],
        },
        {
          kind: 'text',
          title: 'Klantwensen',
          text: narrative,
        },
      ],
    };
  }

  function normalizeOrderDossierPairs(pairs) {
    if (!Array.isArray(pairs)) return [];
    return pairs
      .map((pair) => {
        const label = clipText(normalizeOrderDossierPairLabel(pair?.label || ''), 80);
        const value = clipText(normalizeString(pair?.value || ''), 250);
        if (!label || !value) return null;
        return { label, value };
      })
      .filter(Boolean)
      .slice(0, 12);
  }

  function normalizeOrderDossierItems(items, maxItems = 10) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => clipText(normalizeString(item || ''), 380))
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(20, Number(maxItems) || 10)));
  }

  function normalizeOrderDossierLayout(rawLayout, fallbackOptions = {}) {
    const fallback = buildOrderDossierFallbackLayout(fallbackOptions);
    if (!rawLayout || typeof rawLayout !== 'object') return fallback;

    const documentTitle =
      clipText(
        normalizeString(rawLayout.documentTitle || rawLayout.title || fallback.documentTitle),
        220
      ) || fallback.documentTitle;
    const subtitle =
      clipText(normalizeString(rawLayout.subtitle || rawLayout.lead || fallback.subtitle), 320) ||
      fallback.subtitle;
    const opusPrompt = buildShortOrderDossierOpusPrompt(fallbackOptions);

    const sourceBlocks = Array.isArray(rawLayout.blocks) ? rawLayout.blocks : [];
    const blocks = sourceBlocks
      .map((block) => {
        const kind = normalizeString(block?.kind || block?.type || '').toLowerCase();
        const title = clipText(normalizeString(block?.title || ''), 120) || 'Sectie';
        if (shouldHideOrderDossierBlockTitle(title)) return null;

        if (kind === 'meta') {
          const pairs = normalizeOrderDossierPairs(block?.pairs || block?.items || []);
          if (!pairs.length) return null;
          return { kind: 'meta', title, pairs };
        }

        if (kind === 'bullets' || kind === 'checklist') {
          const items = normalizeOrderDossierItems(block?.items || [], 12);
          if (!items.length) return null;
          return { kind: 'bullets', title, items };
        }

        if (kind === 'steps' || kind === 'timeline') {
          const items = normalizeOrderDossierItems(block?.items || block?.steps || [], 12);
          if (!items.length) return null;
          return { kind: 'steps', title, items };
        }

        const text = clipText(normalizeString(block?.text || block?.content || ''), 5500);
        if (!text) return null;
        return { kind: 'text', title, text };
      })
      .filter(Boolean)
      .slice(0, 10);

    return {
      documentTitle,
      subtitle,
      opusPrompt,
      blocks: blocks.length ? blocks : fallback.blocks,
    };
  }

  function buildAnthropicOrderDossierPrompts(options = {}) {
    const input = buildOrderDossierInput(options);
    const fallback = buildOrderDossierFallbackLayout(input);

    const systemPrompt = [
      'Je bent een senior delivery writer voor Softora.',
      'Taak: maak een dynamisch uitvoerdossier in JSON voor een PDF-weergave.',
      'Belangrijk:',
      '- Schrijf in helder Nederlands.',
      '- Verzin geen feiten die niet in de input staan.',
      '- Gebruik alleen content die direct uit de input volgt; voeg geen generieke projectfasen of teamrichtlijnen toe.',
      '- Gebruik een indeling die past bij de hoeveelheid inhoud (dynamisch, niet template-achtig).',
      '- Gebruik geen bloktitels zoals "Uitvoerplan", "Ontbrekende informatie" of "Praktische aandachtspunten".',
      '- Voeg geen interne velden toe zoals "Accounthouder Softora" of "Softora-contactpersoon".',
      '- Lever een direct copy-paste prompt voor Claude Opus 4.6 die exact 1 zin lang is.',
      '- Gebruik NOOIT ellipsis zoals "...".',
      '- Geef ALLEEN geldig JSON terug, zonder markdown of extra tekst.',
      '',
      'JSON schema:',
      '{',
      '  "documentTitle": "string",',
      '  "subtitle": "string",',
      '  "opusPrompt": "string",',
      '  "blocks": [',
      '    {',
      '      "kind": "meta|text|bullets|steps",',
      '      "title": "string",',
      '      "pairs": [{"label":"string","value":"string"}],',
      '      "text": "string",',
      '      "items": ["string"]',
      '    }',
      '  ]',
      '}',
    ].join('\n');

    const userPrompt = [
      '<order_dossier_request>',
      `<order_id>${input.orderId || ''}</order_id>`,
      `<company>${escapeHtml(input.company || '')}</company>`,
      `<contact>${escapeHtml(input.contact || '')}</contact>`,
      `<title>${escapeHtml(input.title || '')}</title>`,
      `<domain>${escapeHtml(input.domainName || '')}</domain>`,
      `<delivery_time>${escapeHtml(input.deliveryTime || '')}</delivery_time>`,
      `<claimed_by>${escapeHtml(input.claimedBy || '')}</claimed_by>`,
      `<claimed_at>${escapeHtml(input.claimedAt || '')}</claimed_at>`,
      input.sourceAppointmentLabel
        ? `<source_appointment>${escapeHtml(input.sourceAppointmentLabel)}</source_appointment>`
        : '',
      '<customer_description>',
      input.description || '',
      '</customer_description>',
      '<customer_transcript>',
      input.transcript || '',
      '</customer_transcript>',
      '<required_output>',
      '- Maak een dynamische sectie-indeling op basis van de beschikbare content.',
      '- Zorg dat er altijd minimaal 1 meta-block en 1 inhoudsblock aanwezig is.',
      '- Gebruik alleen dossierblokken die direct op de invoer zijn gebaseerd.',
      '- Laat blokken met algemene projectplanning, ontbrekende-informatie-lijsten en praktische teamnotities weg.',
      '- Laat interne Softora-contactvelden zoals account- of contactpersoonlabels weg.',
      '- opusPrompt moet direct bruikbaar zijn voor Claude Opus 4.6 en exact 1 zin lang zijn.',
      '</required_output>',
      '<fallback_reference>',
      JSON.stringify(fallback),
      '</fallback_reference>',
      '</order_dossier_request>',
    ]
      .filter(Boolean)
      .join('\n');

    return { input, fallback, systemPrompt, userPrompt };
  }

  return {
    buildOrderDossierInput,
    buildOrderDossierNarrative,
    buildShortOrderDossierOpusPrompt,
    normalizeOrderDossierBlockTitle,
    shouldHideOrderDossierBlockTitle,
    normalizeOrderDossierPairLabel,
    buildOrderDossierFallbackLayout,
    normalizeOrderDossierPairs,
    normalizeOrderDossierItems,
    normalizeOrderDossierLayout,
    buildAnthropicOrderDossierPrompts,
  };
}

module.exports = {
  createOrderDossierHelpers,
};
