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

  function extractWebsiteStyleHintFromOrderInput(input) {
    const blob = [
      normalizeString(input?.description || ''),
      normalizeString(input?.transcript || ''),
      normalizeString(input?.title || ''),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    const hasBlue = /\bblauw(e|we)?\b/.test(blob) || /\bblue\b/.test(blob);
    const hasWhite = /\bwit(te)?\b/.test(blob) || /\bwhite\b/.test(blob);
    if (hasBlue && hasWhite) {
      return ' in een strak blauw-wit kleurenschema';
    }
    if (hasBlue) {
      return ' met blauw als hoofdkleur in een rustig, premium palet';
    }
    if (hasWhite) {
      return ' met een lichte, frisse witte basis en premium uitstraling';
    }
    return ' met hoogwaardige typografie en een strak, professioneel premium design';
  }

  function orderInputHasUsableDomain(input) {
    const raw = normalizeString(input?.domainName || '');
    if (!raw) return false;
    const compact = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    if (/^[\u2014\-–—]+$/u.test(raw.trim())) return false;
    const noise = new Set([
      '—',
      '-',
      'n/a',
      'na',
      'nog niet opgegeven',
      'onbekend',
      'tbd',
      'todo',
    ]);
    if (noise.has(compact)) return false;
    return true;
  }

  function buildShortOrderDossierOpusPrompt(options = {}) {
    const input = buildOrderDossierInput(options);
    const company = normalizeString(input.company);
    const label = company && company !== 'Onbekend' ? company : 'de klant';
    const domainPart = orderInputHasUsableDomain(input) ? ` voor ${normalizeString(input.domainName)}` : '';
    const styleHint = extractWebsiteStyleHintFromOrderInput(input);
    return `Bouw een premium, moderne en volledig responsieve website voor ${label}${domainPart}${styleHint}; gebruik dit dossier voor inhoud, structuur en contact en zet ontbrekende onderdelen netjes als placeholder.`;
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
    if (normalized === 'domein' || normalized === 'oplevertijd') {
      return '';
    }
    if (normalized === 'adres') {
      return 'Locatie';
    }
    return normalized === 'geclaimd door' ? 'Aangewezen aan' : label;
  }

  const PROJECT_PAIR_ORDER = ['bedrijf', 'aangewezen aan', 'locatie'];

  function categorizeOrderDossierBlock(block) {
    const kind = normalizeString(block?.kind || '').toLowerCase();
    const t = normalizeOrderDossierBlockTitle(block?.title || '');
    if (kind === 'text' && (t.includes('bouwprompt') || t.includes('website-bouw'))) {
      return 'skip';
    }
    if (kind === 'meta' && (t === 'projectkern' || t === 'projectgegevens')) {
      return 'project';
    }
    if (kind === 'meta') {
      return 'meta_other';
    }
    if (kind === 'text') {
      return 'text';
    }
    if (
      kind === 'bullets' ||
      kind === 'checklist' ||
      kind === 'steps' ||
      kind === 'timeline'
    ) {
      return 'list';
    }
    return 'skip';
  }

  function buildDefaultOrderDossierStatusItems(input) {
    const items = [];
    const apt = normalizeString(input?.sourceAppointmentLabel || '');
    const claimed = normalizeString(input?.claimedAt || '');
    if (apt) {
      items.push(`Geplande afspraak: ${apt}`);
    }
    if (claimed) {
      items.push(`Opdracht geclaimd op ${claimed}`);
    }
    if (!items.length) {
      items.push('Nog geen aanvullende status of afspraken vastgelegd.');
    }
    return items;
  }

  function canonicalizeOrderDossierBlocks(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) {
      return [];
    }

    const projectPairMap = new Map();
    const summaryParts = [];
    const statusItems = [];
    const seenStatus = new Set();

    function pushStatus(line) {
      const clipped = clipText(normalizeString(line), 400);
      if (!clipped) return;
      const key = clipped.toLowerCase();
      if (seenStatus.has(key)) return;
      seenStatus.add(key);
      statusItems.push(clipped);
    }

    function absorbProjectPairs(pairs) {
      const normalized = normalizeOrderDossierPairs(pairs || []);
      for (const pair of normalized) {
        const labelRaw = normalizeString(pair?.label || '');
        const value = clipText(normalizeString(pair?.value || ''), 250);
        if (!labelRaw || !value) continue;
        const ln = labelRaw.toLowerCase();
        if (ln === 'contactpersoon' || ln === 'geclaimd op') {
          pushStatus(`${labelRaw}: ${value}`);
          continue;
        }
        let displayLabel = labelRaw;
        if (ln === 'adres') {
          displayLabel = 'Locatie';
        }
        const lk = displayLabel.toLowerCase();
        if (!projectPairMap.has(lk)) {
          projectPairMap.set(lk, { label: displayLabel, value });
        }
      }
    }

    function absorbOtherMetaPairs(pairs) {
      const normalized = normalizeOrderDossierPairs(pairs || []);
      for (const pair of normalized) {
        const label = normalizeString(pair?.label || '');
        const value = clipText(normalizeString(pair?.value || ''), 250);
        if (!label || !value) continue;
        pushStatus(`${label}: ${value}`);
      }
    }

    for (const block of blocks) {
      const cat = categorizeOrderDossierBlock(block);
      if (cat === 'skip') continue;

      if (cat === 'project') {
        absorbProjectPairs(block?.pairs || block?.items || []);
        continue;
      }

      if (cat === 'meta_other') {
        absorbOtherMetaPairs(block?.pairs || block?.items || []);
        continue;
      }

      if (cat === 'text') {
        const text = clipText(normalizeString(block?.text || block?.content || ''), 5500);
        if (text) summaryParts.push(text);
        continue;
      }

      if (cat === 'list') {
        const rawItems = block?.items || block?.steps || [];
        const items = normalizeOrderDossierItems(rawItems, 20);
        for (const item of items) {
          pushStatus(item);
        }
      }
    }

    const projectPairs = [];
    for (const key of PROJECT_PAIR_ORDER) {
      if (projectPairMap.has(key)) {
        projectPairs.push(projectPairMap.get(key));
      }
    }
    for (const [k, pair] of projectPairMap) {
      if (PROJECT_PAIR_ORDER.includes(k)) continue;
      pushStatus(`${pair.label}: ${pair.value}`);
    }

    const out = [];
    if (projectPairs.length) {
      out.push({ kind: 'meta', title: 'Projectgegevens', pairs: projectPairs });
    }
    const summary = summaryParts.join('\n\n').trim();
    if (summary) {
      out.push({ kind: 'text', title: 'Samenvatting klantgesprek', text: summary });
    }
    if (statusItems.length) {
      out.push({
        kind: 'bullets',
        title: 'Status en afspraken',
        items: statusItems.slice(0, 16),
      });
    }

    return out;
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
          title: 'Projectgegevens',
          pairs: [
            { label: 'Bedrijf', value: input.company || '—' },
            { label: 'Aangewezen aan', value: input.claimedBy || '—' },
            { label: 'Locatie', value: input.contact || '—' },
          ],
        },
        {
          kind: 'text',
          title: 'Samenvatting klantgesprek',
          text: narrative,
        },
        {
          kind: 'bullets',
          title: 'Status en afspraken',
          items: buildDefaultOrderDossierStatusItems(input),
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
    const opusFromLayout = clipText(normalizeString(rawLayout.opusPrompt || ''), 20000);
    const opusPrompt = opusFromLayout || fallback.opusPrompt;

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

    const canon = canonicalizeOrderDossierBlocks(blocks);

    return {
      documentTitle,
      subtitle,
      opusPrompt,
      blocks: canon.length ? canon : fallback.blocks,
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
      '- Gebruik een vaste volgorde met precies drie inhoudsblokken vóór de bouwprompt: (1) meta met titel "Projectgegevens" en uitsluitend de paren Bedrijf, Aangewezen aan en Locatie (Locatie = vestigings- of bezoekadres uit de input), (2) text met titel "Samenvatting klantgesprek" met lopende tekst uit beschrijving en transcript, (3) bullets met titel "Status en afspraken" met feitelijke punten (afspraken, bevestigingen, stijl, vervolgstappen).',
      '- Voeg geen aparte blokken toe met titels zoals "Geplande afspraak", "Achtergrond en klantwensen", "Vastgelegde stijlvoorkeur" of "Projectkern"; werk die inhoud in Samenvatting of Status weg.',
      '- Gebruik geen bloktitels zoals "Uitvoerplan", "Ontbrekende informatie" of "Praktische aandachtspunten".',
      '- Voeg geen interne velden toe zoals "Accounthouder Softora" of "Softora-contactpersoon".',
      '- Lever een korte, direct copy-paste bouwprompt in het Nederlands voor een AI die de website ontwerpt en bouwt.',
      '- De prompt is concrete uitvoerinstructie (premium responsive site, stijl, sfeer) en bevat alleen wat uit de input volgt; geen verzonnen features of huisstijl.',
      '- Gebruik geen meta-regels over modellen, Softora, dossiers of gekoppelde informatie.',
      '- Houd de prompt bondig (liefst één zin, maximaal twee korte zinnen), zonder opsommingen.',
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
      '- Lever altijd precies die drie bloktypes in deze volgorde (geen extra blokken).',
      '- Zorg dat elk van de drie blokken inhoud heeft; gebruik "—" alleen waar de input echt leeg is.',
      '- Gebruik alleen dossierblokken die direct op de invoer zijn gebaseerd.',
      '- Laat blokken met algemene projectplanning, ontbrekende-informatie-lijsten en praktische teamnotities weg.',
      '- Laat interne Softora-contactvelden zoals account- of contactpersoonlabels weg.',
      '- opusPrompt moet een echte bouwprompt zijn (geen verwijzing naar het dossierbestand of naar een specifiek model).',
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
    canonicalizeOrderDossierBlocks,
    buildAnthropicOrderDossierPrompts,
  };
}

module.exports = {
  createOrderDossierHelpers,
};
