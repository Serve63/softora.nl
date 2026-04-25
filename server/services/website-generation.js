function createWebsiteGenerationHelpers(deps = {}) {
  const {
    env = process.env,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    clipText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    escapeHtml = (value) => String(value || ''),
    sanitizeReferenceImages = () => [],
  } = deps;

  function cleanWebsitePreviewList(items = [], maxItems = 6, maxLength = 180) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .map((item) => truncateText(normalizeString(item || ''), maxLength))
      .filter(Boolean)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxItems);
  }

  function extractWebsitePreviewActionPhrases(scan = {}) {
    const haystack = [
      scan.h1,
      ...(Array.isArray(scan.headings) ? scan.headings : []),
      ...(Array.isArray(scan.paragraphs) ? scan.paragraphs : []),
      scan.bodyTextSample,
    ].join(' ');
    const phrases = [];
    const pattern = /\b(?:start|plan|vraag|boek|ontdek|bekijk|lees|neem contact|contact|offerte|demo|kennismaking|advies|strategie|project|website|software|chatbot|automatisering)[\w\s-]{0,42}/gi;
    let match;
    while ((match = pattern.exec(haystack))) {
      const phrase = truncateText(normalizeString(match[0]).replace(/\s+/g, ' '), 80);
      if (phrase) phrases.push(phrase);
      if (phrases.length >= 8) break;
    }
    return cleanWebsitePreviewList(phrases, 6, 80);
  }

  function parseHexColorLuminance(colorRaw) {
    const color = normalizeString(colorRaw || '').toLowerCase();
    const match = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;
    const value = match[1];
    const r = value.length === 3 ? Number.parseInt(value[0] + value[0], 16) : Number.parseInt(value.slice(0, 2), 16);
    const g = value.length === 3 ? Number.parseInt(value[1] + value[1], 16) : Number.parseInt(value.slice(2, 4), 16);
    const b = value.length === 3 ? Number.parseInt(value[2] + value[2], 16) : Number.parseInt(value.slice(4, 6), 16);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function inferWebsitePreviewPaletteMood(colors = []) {
    const luminances = (Array.isArray(colors) ? colors : [])
      .map(parseHexColorLuminance)
      .filter((value) => Number.isFinite(value));
    if (!luminances.length) return '';
    const dark = luminances.filter((value) => value < 0.28).length;
    const light = luminances.filter((value) => value > 0.78).length;
    if (dark >= 2 && light >= 1) return 'hoog contrast met donkere en lichte vlakken';
    if (dark >= Math.max(2, light + 1)) return 'overwegend donker';
    if (light >= Math.max(2, dark + 1)) return 'overwegend licht';
    return 'gemengd/gebalanceerd';
  }

  function buildWebsitePreviewDesignDnaFromScan(scan = {}) {
    const host = normalizeString(scan.host || '');
    const title = normalizeString(scan.title || '');
    const h1 = normalizeString(scan.h1 || '');
    const description = normalizeString(scan.metaDescription || '');
    const headings = cleanWebsitePreviewList(scan.headings, 6, 160);
    const paragraphs = cleanWebsitePreviewList(scan.paragraphs, 5, 220);
    const visualCues = cleanWebsitePreviewList(scan.visualCues, 6, 120);
    const brandColorHints = cleanWebsitePreviewList(scan.brandColorHints, 6, 120);
    const brandPalette = cleanWebsitePreviewList(scan.brandPalette, 8, 40);
    const navigationLabels = cleanWebsitePreviewList(scan.navigationLabels, 10, 80);
    const ctaLabels = cleanWebsitePreviewList(scan.ctaLabels, 10, 100);
    const fontHints = cleanWebsitePreviewList(scan.fontHints, 5, 120);
    const layoutHints = cleanWebsitePreviewList(scan.layoutHints, 8, 120);
    const actionPhrases = extractWebsitePreviewActionPhrases(scan);
    const bodyTextSample = truncateText(normalizeString(scan.bodyTextSample || ''), 650);
    const contentSignals = cleanWebsitePreviewList(
      [h1, description, ...headings, ...paragraphs, bodyTextSample],
      10,
      220
    );

    return {
      brand: host || title || 'onbekende website',
      sourceSummary: [title, h1, description].filter(Boolean).join(' | '),
      mandatoryPalette: brandPalette.length ? brandPalette : brandColorHints,
      brandColorHints,
      paletteMood: inferWebsitePreviewPaletteMood(brandPalette),
      contentSignals,
      sectionSignals: headings,
      navigationSignals: navigationLabels,
      ctaSignals: ctaLabels,
      actionSignals: cleanWebsitePreviewList([...ctaLabels, ...actionPhrases], 10, 100),
      visualSignals: visualCues,
      typographySignals: fontHints,
      layoutSignals: layoutHints,
      improvementRule:
        'Verbeter layout, hiërarchie, spacing, typografie, kaarten, CTA’s en visuele polish, maar behoud merk-DNA, kleuren, onderwerp en commerciële richting.',
      forbiddenDrift:
        'Geen rebrand, geen ander kleurenpalet, geen generiek SaaS/software-template, geen andere diensten, geen andere doelgroep, geen andere navigatie/CTA-taal en geen copy die losstaat van de gescande site.',
    };
  }

  function formatWebsitePreviewDesignDnaLock(scan = {}) {
    const dna = buildWebsitePreviewDesignDnaFromScan(scan);
    return [
      'DESIGN-DNA LOCK (verplicht volgen, niet negeren):',
      `- Bronmerk/URL: ${dna.brand}.`,
      dna.sourceSummary ? `- Begrijp eerst deze bron-samenvatting: ${dna.sourceSummary}.` : '',
      dna.mandatoryPalette.length
        ? `- Verplicht kleurenpalet/kleurfamilie: ${dna.mandatoryPalette.join(' | ')}. Deze kleuren moeten dominant blijven.`
        : '',
      dna.brandColorHints.length
        ? `- CSS/merk-kleurhints uit de site: ${dna.brandColorHints.join(' | ')}.`
        : '',
      dna.paletteMood ? `- Licht/donker-verhouding: ${dna.paletteMood}. Behoud deze verhouding in de nieuwe variant.` : '',
      dna.contentSignals.length
        ? `- Content/propositie die herkenbaar terug moet komen: ${dna.contentSignals.join(' | ')}.`
        : '',
      dna.sectionSignals.length
        ? `- Secties/structuur-signalen uit de huidige site: ${dna.sectionSignals.join(' | ')}.`
        : '',
      dna.navigationSignals.length
        ? `- Navigatie-labels zo herkenbaar mogelijk behouden: ${dna.navigationSignals.join(' | ')}.`
        : '',
      dna.ctaSignals.length
        ? `- CTA-knoppen/actiecopy zo herkenbaar mogelijk behouden: ${dna.ctaSignals.join(' | ')}.`
        : '',
      dna.actionSignals.length
        ? `- CTA/actie-signalen uit de huidige site: ${dna.actionSignals.join(' | ')}.`
        : '',
      dna.typographySignals.length
        ? `- Typografie/font-signalen: ${dna.typographySignals.join(' | ')}. Gebruik een vergelijkbaar typografisch gevoel.`
        : '',
      dna.layoutSignals.length
        ? `- Layoutsignalen uit de huidige site: ${dna.layoutSignals.join(' | ')}.`
        : '',
      dna.visualSignals.length ? `- Visuele signalen uit beelden/alt-teksten: ${dna.visualSignals.join(' | ')}.` : '',
      `- Verbeterregel: ${dna.improvementRule}`,
      `- Verboden drift: ${dna.forbiddenDrift}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  function buildWebsitePreviewPromptFromScan(scan = {}) {
    const host = normalizeString(scan.host || '');
    const title = normalizeString(scan.title || '');
    const description = normalizeString(scan.metaDescription || '');
    const h1 = normalizeString(scan.h1 || '');
    const headings = Array.isArray(scan.headings) ? scan.headings.filter(Boolean).slice(0, 6) : [];
    const paragraphs = Array.isArray(scan.paragraphs) ? scan.paragraphs.filter(Boolean).slice(0, 5) : [];
    const visualCues = Array.isArray(scan.visualCues) ? scan.visualCues.filter(Boolean).slice(0, 6) : [];
    const brandColorHints = Array.isArray(scan.brandColorHints)
      ? scan.brandColorHints.filter(Boolean).slice(0, 6)
      : [];
    const brandPalette = Array.isArray(scan.brandPalette)
      ? scan.brandPalette.filter(Boolean).slice(0, 6)
      : [];
    const navigationLabels = Array.isArray(scan.navigationLabels)
      ? scan.navigationLabels.filter(Boolean).slice(0, 10)
      : [];
    const ctaLabels = Array.isArray(scan.ctaLabels) ? scan.ctaLabels.filter(Boolean).slice(0, 10) : [];
    const fontHints = Array.isArray(scan.fontHints) ? scan.fontHints.filter(Boolean).slice(0, 5) : [];
    const layoutHints = Array.isArray(scan.layoutHints) ? scan.layoutHints.filter(Boolean).slice(0, 8) : [];
    const referenceImageCount = Math.max(0, Number(scan.referenceImageCount || 0) || 0);
    const bodyTextSample = truncateText(normalizeString(scan.bodyTextSample || ''), 1800);

    return [
      'Bekijk eerst de website grondig op basis van de URL-scan hieronder: begrijp merkidentiteit, branche, contentbasis, kleuren, sfeer en doelgroep. Gebruik deze scan en eventuele referentiebeelden alleen als moodboard/context, niet als layout-template.',
      referenceImageCount
        ? `Er zijn ${referenceImageCount} referentiebeeld(en) meegegeven; behandel die uitsluitend als moodboard voor merkidentiteit, kleuren, sfeer en doelgroep.`
        : '',
      'Genereer een volledig nieuw ultra-premium full-page desktop homepage-concept waarbij de aangeleverde screenshot alleen dient als moodboard voor merkidentiteit, branche, contentbasis, kleuren, sfeer en doelgroep, maar ontwerp vanaf nul een radicaal andere Awwwards-level website met een totaal nieuwe informatiearchitectuur, geen herkenbare kopie van layout, hero, sectievolgorde, grids, kaartenrijen, iconenblokken, USP-blokken of footerstructuur, en creëer in plaats daarvan een rustige, ruimtelijke, branche-passende editorial compositie met veel negative space, sterke visual hierarchy, hoogwaardige beeldregie, asymmetrische layout, subtiele diepte, verfijnde CTA’s, premium typografie en maximaal 5 grote ademende contentmomenten.',
      host ? `Domein of merk: ${host}.` : '',
      title ? `Huidige paginatitel: ${title}.` : '',
      description ? `Huidige meta-omschrijving: ${description}.` : '',
      h1 ? `Belangrijkste huidige heading: ${h1}.` : '',
      headings.length ? `Overige huidige headings: ${headings.join(' | ')}.` : '',
      navigationLabels.length ? `Originele navigatie-labels: ${navigationLabels.join(' | ')}.` : '',
      ctaLabels.length ? `Originele CTA/knop-labels: ${ctaLabels.join(' | ')}.` : '',
      paragraphs.length ? `Inhoudelijke cues van de huidige site: ${paragraphs.join(' | ')}.` : '',
      visualCues.length ? `Visuele cues van de huidige site: ${visualCues.join(' | ')}.` : '',
      brandColorHints.length ? `Gedetecteerde merkkleur-variabelen: ${brandColorHints.join(' | ')}.` : '',
      brandPalette.length ? `Gedetecteerde terugkerende merkkleuren: ${brandPalette.join(' | ')}.` : '',
      fontHints.length ? `Gedetecteerde typografie/font hints: ${fontHints.join(' | ')}.` : '',
      layoutHints.length ? `Gedetecteerde layout/stijl hints: ${layoutHints.join(' | ')}.` : '',
      bodyTextSample ? `Tekstsample van de huidige site: ${bodyTextSample}` : '',
      'Lever exact 1 hoge portrait full-page desktop homepage screenshot op.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  function buildWebsitePreviewBriefFromScan(scan = {}) {
    const parts = [];
    if (scan.title) parts.push(`Titel: ${scan.title}`);
    if (scan.h1) parts.push(`Hoofdboodschap: ${scan.h1}`);
    if (scan.metaDescription) parts.push(`Omschrijving: ${scan.metaDescription}`);
    if (Array.isArray(scan.headings) && scan.headings.length) {
      parts.push(`Secties: ${scan.headings.slice(0, 4).join(', ')}`);
    }
    if (Array.isArray(scan.visualCues) && scan.visualCues.length) {
      parts.push(`Beeldreferenties: ${scan.visualCues.slice(0, 4).join(', ')}`);
    }
    if (Array.isArray(scan.brandPalette) && scan.brandPalette.length) {
      parts.push(`Kleuren: ${scan.brandPalette.slice(0, 4).join(', ')}`);
    }
    return parts.join(' · ');
  }

  function buildWebsitePreviewDownloadFileName(scan = {}) {
    const host = normalizeString(scan.host || '')
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const fallback = host || 'websitegenerator';
    return `${fallback}-preview.png`;
  }

  function stripHtmlCodeFence(text) {
    const raw = normalizeString(text || '');
    if (!raw) return '';
    const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
    return fenced ? normalizeString(fenced[1]) : raw;
  }

  function ensureHtmlDocument(rawHtml, meta = {}) {
    const text = stripHtmlCodeFence(rawHtml);
    if (!text) return '';

    if (/<html[\s>]/i.test(text) && /<body[\s>]/i.test(text)) {
      return clipText(text, 200000);
    }

    const title = truncateText(normalizeString(meta.title || meta.company || 'Generated Website'), 120);
    const wrapped = `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title || 'Generated Website'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 0; padding: 0; }
  </style>
</head>
<body>
${text}
</body>
</html>`;
    return clipText(wrapped, 200000);
  }

  function ensureStrictAnthropicHtml(rawHtml) {
    const text = stripHtmlCodeFence(rawHtml);
    if (!text) return '';
    const trimmed = clipText(text, 200000);
    const hasHtmlRoot = /<html[\s>]/i.test(trimmed) && /<body[\s>]/i.test(trimmed);
    if (!hasHtmlRoot) return '';
    return trimmed;
  }

  function extractVisibleTextFromHtml(html) {
    const raw = normalizeString(html || '');
    if (!raw) return '';
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isLikelyUsableWebsiteHtml(html) {
    const raw = normalizeString(html || '');
    if (!raw) return false;
    const lower = raw.toLowerCase();

    const semanticCount = (lower.match(/<(header|main|section|footer|nav|form)\b/g) || []).length;
    const ctaCount = (lower.match(/<(a|button)\b/g) || []).length;
    const headingCount = (lower.match(/<h[1-4]\b/g) || []).length;
    const textLen = extractVisibleTextFromHtml(raw).length;

    return semanticCount >= 3 && ctaCount >= 2 && headingCount >= 2 && textLen >= 180;
  }

  function inferWebsiteIndustryProfile(context = {}) {
    const sourceText = [
      normalizeString(context.company || ''),
      normalizeString(context.title || ''),
      normalizeString(context.description || ''),
      normalizeString(context.promptText || ''),
    ]
      .filter(Boolean)
      .join(' \n ')
      .toLowerCase();

    const profiles = [
      {
        key: 'hair_salon',
        pattern: /\b(kapper|kapsalon|barber|barbershop|hairstyl|haarstudio|salon)\b/i,
        label: 'Kapsalon / barber',
        audience:
          'Lokale bezoekers die snel vertrouwen willen voelen en direct een afspraak willen boeken.',
        offers:
          'Knippen, kleuren, stylen, baardverzorging, advies, arrangementen en terugkerende afspraken.',
        style:
          'Editorial, verzorgd, premium maar toegankelijk, met tastbare sfeer en een modieuze uitstraling.',
        trust:
          'Laat openingstijden, locatie, service-overzicht, reviews, voor/na-proof of klantgericht vakmanschap duidelijk terugkomen.',
        cta: 'Plan een afspraak',
      },
      {
        key: 'restaurant',
        pattern: /\b(restaurant|bistro|brasserie|cafe|café|horeca|lunchroom|eten|menu)\b/i,
        label: 'Restaurant / horeca',
        audience: 'Bezoekers die sfeer, menukeuze en praktische info razendsnel willen begrijpen.',
        offers: 'Menu, specialiteiten, reserveren, openingstijden, locatie, groepsmogelijkheden.',
        style: 'Sfeervol, smaakvol, warm en gastvrij met duidelijke hiërarchie en ambiance.',
        trust: 'Laat sfeer, specialiteiten, locatie, openingstijden en reserverings-CTA sterk landen.',
        cta: 'Reserveer nu',
      },
      {
        key: 'construction',
        pattern: /\b(aannemer|bouw|verbouw|renovatie|schilder|klus|dak|installatie|timmer)\b/i,
        label: 'Bouw / vakwerk',
        audience:
          'Huiseigenaren en bedrijven die betrouwbaarheid, aanpak en tastbaar vakmanschap willen zien.',
        offers: 'Projecttypen, werkwijze, offerte-aanvraag, servicegebied, referenties, garanties.',
        style: 'Stevig, betrouwbaar, helder en professioneel met veel structuur en vertrouwen.',
        trust: 'Gebruik een no-nonsense opbouw met proces, voorbeelden, contact en duidelijke CTA.',
        cta: 'Vraag een offerte aan',
      },
      {
        key: 'consulting',
        pattern: /\b(coach|consult|advies|consultant|marketing|agency|bureau|seo|strateg)\b/i,
        label: 'Consultancy / bureau',
        audience: 'Beslissers die snel grip willen op resultaat, expertise en vervolgstap.',
        offers: 'Diensten, trajecten, aanpak, cases, expertise, intake of strategiegesprek.',
        style: 'Scherp, modern, intelligent en conversion-first met een duidelijke premium uitstraling.',
        trust: 'Laat expertise, werkwijze, resultaat en heldere CTA’s de kern vormen.',
        cta: 'Plan een gesprek',
      },
    ];

    const matched = profiles.find((profile) => profile.pattern.test(sourceText));
    if (matched) return matched;

    return {
      key: 'local_service',
      label: 'Lokale dienstverlener',
      audience: 'Mensen die snel willen begrijpen wat het aanbod is en direct contact willen opnemen.',
      offers: 'Kernservices, voordelen, werkwijze, vertrouwen, contact en conversiegerichte CTA’s.',
      style: 'Premium, helder, eigentijds en doelgericht zonder generieke template-uitstraling.',
      trust: 'Focus op helder aanbod, sterke positionering, vertrouwen en een logische contactflow.',
      cta: 'Neem contact op',
    };
  }

  function buildWebsiteGenerationContext(options = {}) {
    const promptText = truncateText(normalizeString(options.prompt || ''), 40000);
    if (!promptText) {
      const err = new Error('Prompt ontbreekt voor website generatie.');
      err.status = 400;
      throw err;
    }

    const company = truncateText(normalizeString(options.company || ''), 160);
    const title = truncateText(normalizeString(options.title || ''), 200);
    const description = truncateText(normalizeString(options.description || ''), 3000);
    const language = normalizeString(options.language || 'nl') || 'nl';
    const referenceImages = sanitizeReferenceImages(options.referenceImages || options.attachments || [], {
      maxItems: 6,
      maxBytesPerImage: 550 * 1024,
      maxTotalBytes: 3 * 1024 * 1024,
    });
    const industry = inferWebsiteIndustryProfile({ company, title, description, promptText });

    return {
      company,
      title,
      description,
      language,
      promptText,
      referenceImages,
      industry,
    };
  }

  function buildWebsiteGenerationPrompts(options = {}) {
    const context = buildWebsiteGenerationContext(options);
    const { company, title, description, language, promptText, referenceImages, industry } = context;

    const systemPrompt = [
      'Je bent een elite webdesigner, conversion strategist en senior front-end engineer.',
      'Genereer exact één volledig HTML-document met inline CSS en alleen indien functioneel nodig inline JavaScript.',
      'Werk als een art director: intentional, premium, logisch, ruimtelijk sterk en consistent.',
      'Geen markdown, geen uitleg, alleen de HTML-code.',
      'Je mag wel logische standaard-aanbodstructuur afleiden uit het type bedrijf, maar verzin geen concrete awards, adressen, reviews of claims die niet onderbouwd zijn.',
      'Voorkom generieke blokken, slordige spacing, vreemde overlaps of sections die los van elkaar voelen.',
    ].join('\n');

    const userPrompt = [
      '<website_request>',
      `<language>${escapeHtml(language)}</language>`,
      company ? `<company>${escapeHtml(company)}</company>` : '',
      title ? `<project_title>${escapeHtml(title)}</project_title>` : '',
      description ? `<project_description>${escapeHtml(description)}</project_description>` : '',
      `<industry>${escapeHtml(industry.label)}</industry>`,
      `<likely_audience>${escapeHtml(industry.audience)}</likely_audience>`,
      `<likely_offers>${escapeHtml(industry.offers)}</likely_offers>`,
      `<style_direction>${escapeHtml(industry.style)}</style_direction>`,
      `<trust_notes>${escapeHtml(industry.trust)}</trust_notes>`,
      `<primary_cta>${escapeHtml(industry.cta)}</primary_cta>`,
      referenceImages.length ? `<reference_image_count>${referenceImages.length}</reference_image_count>` : '',
      referenceImages.length
        ? `<reference_images>${escapeHtml(referenceImages.map((item) => item.name).join(', '))}</reference_images>`
        : '',
      '<quality_bar>',
      'Maak een premium website die voelt als maatwerk, niet als template.',
      'Zorg dat compositie, breedtes, hiërarchie, witruimte, CTA-flow en mobiele layout coherent zijn.',
      'Gebruik een duidelijk visueel systeem: sterke typografie, ritme tussen secties, onderscheidende hero en consequente componenten.',
      'Als informatie ontbreekt, vul dan geen nep-feiten in maar ontwerp de structuur slim en geloofwaardig.',
      referenceImages.length
        ? 'Gebruik de meegeleverde referentiebeelden als visuele input voor stijl, compositie en sfeer.'
        : '',
      '</quality_bar>',
      '<project_prompt>',
      promptText,
      '</project_prompt>',
      '</website_request>',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      ...context,
      systemPrompt,
      userPrompt,
    };
  }

  function buildAnthropicWebsiteHtmlPrompts(options = {}, blueprintText = '') {
    const context = buildWebsiteGenerationContext(options);
    const { company, title, description, language, promptText, referenceImages } = context;

    const systemPrompt = [
      'Je bent een elite front-end designer en engineer die premium marketingwebsites bouwt.',
      'Schrijf exact één volledig HTML-document met inline CSS en alleen functioneel noodzakelijke inline JavaScript.',
      'Lever maatwerk, geen templategevoel: sterke hero, duidelijke visuele hiërarchie, ritme, compositie, contrast en polish.',
      'De pagina moet coherent zijn op desktop EN mobiel. Geen overlappende elementen, geen vreemde lege stroken, geen kapotte breedtes, geen debugtekst.',
      'De bovenkant van de site moet uitzonderlijk sterk zijn: header en hero moeten als één premium geheel voelen.',
      'Vermijd een klein los contentblok in het midden van een groot leeg vlak. Above-the-fold moet breed, intentioneel en visueel kloppend zijn.',
      'Gebruik semantische HTML, logische CTA-flow en copy die geloofwaardig blijft.',
      'Geen markdown of uitleg. Alleen HTML die begint met <!doctype html>.',
      'Voer intern eerst een kwaliteitscontrole uit op spacing, alignment, section flow, readability, responsiveness en visuele consistentie voordat je antwoordt.',
    ].join('\n');

    const userPrompt = [
      '<website_build_request>',
      `<language>${escapeHtml(language)}</language>`,
      company ? `<company>${escapeHtml(company)}</company>` : '',
      title ? `<project_title>${escapeHtml(title)}</project_title>` : '',
      description ? `<project_description>${escapeHtml(description)}</project_description>` : '',
      referenceImages.length ? `<reference_image_count>${referenceImages.length}</reference_image_count>` : '',
      '<source_prompt>',
      promptText,
      '</source_prompt>',
      '<approved_blueprint>',
      blueprintText,
      '</approved_blueprint>',
      '<build_rules>',
      '- Bouw een premium single-page marketingwebsite tenzij de brief expliciet meerdere pagina’s vereist.',
      '- Gebruik een duidelijke container-structuur en consistente max-widths.',
      '- Geef elke sectie een heldere functie; geen willekeurige kaarten of losse blokken.',
      '- Zorg dat de hero visueel royaal is en de bovenkant van de pagina overtuigend opent.',
      '- Laat header en hero dezelfde sfeer delen; geen top die voelt alsof componenten uit verschillende templates komen.',
      '- Vermijd een smalle gecentreerde hero-card op een willekeurige achtergrond tenzij de briefing dat expliciet vraagt.',
      '- Laat navigatie, hero, aanbod, vertrouwen, over-ons, contact en footer als één logisch verhaal voelen.',
      '- Gebruik onderscheidende maar betrouwbare typografie en een kleurpalet dat past bij de briefing.',
      referenceImages.length
        ? '- Er zijn referentiebeelden meegestuurd: gebruik die als visuele richting voor stijl, compositie en sfeer.'
        : '',
      '- Geen fake testimonials, nep-statistieken of verzonnen adressen.',
      '- Contactformulier en CTA moeten visueel kloppen en logisch geplaatst zijn.',
      '- Alle content moet direct renderen zonder externe assets of libraries.',
      '</build_rules>',
      '</website_build_request>',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      ...context,
      systemPrompt,
      userPrompt,
    };
  }

  function buildLocalWebsiteBlueprint(options = {}) {
    const context = buildWebsiteGenerationContext(options);
    const { company, title, description, industry, promptText } = context;
    const brandName = company || title || industry.label;

    return [
      '<website_blueprint>',
      `<brand_core>${escapeHtml(
        `${brandName}: premium positionering, duidelijke waardepropositie en een geloofwaardige lokale of specialistische uitstraling.`
      )}</brand_core>`,
      `<audience>${escapeHtml(industry.audience)}</audience>`,
      `<conversion_goal>${escapeHtml(
        `Primaire conversie: ${industry.cta}. Secundair: vertrouwen opbouwen en contact laagdrempelig maken.`
      )}</conversion_goal>`,
      `<art_direction>${escapeHtml(
        `${industry.style} Werk met een duidelijke hero-compositie, sterke typografie, ritme tussen secties en een kleurpalet dat premium voelt zonder onlogisch te worden. Laat de bovenkant breed, rijk en samenhangend openen in plaats van als een klein los blok te voelen.`
      )}</art_direction>`,
      `<page_structure>${escapeHtml(
        'Header/navigatie, hero met kernbelofte en CTA, aanbod of diensten, onderscheidend vermogen of voordelen, vertrouwen/social proof zonder nepclaims, over ons of vakmanschap, contact/afspraaksectie en footer.'
      )}</page_structure>`,
      `<section_notes>${escapeHtml(
        `Zorg dat elke sectie een eigen functie heeft. Verwerk ${industry.offers} alleen voor zover geloofwaardig binnen de prompt en hou de tekst concreet, conversiegericht en logisch opgebouwd.`
      )}</section_notes>`,
      `<content_plan>${escapeHtml(
        `Gebruik de bronprompt en projectomschrijving als primaire waarheid. Omschrijving: ${description || 'niet opgegeven'}. Verzin geen concrete feitelijke claims, adressen, cijfers of reviews. Bronprompt: ${promptText}`
      )}</content_plan>`,
      `<quality_checks>${escapeHtml(
        'Geen templategevoel, geen overlapping, geen slordige spacing, consistente containerbreedtes, mobiele logica, sterke CTA-flow, geloofwaardige copy, een overtuigende above-the-fold en een visueel samenhangend geheel.'
      )}</quality_checks>`,
      '</website_blueprint>',
    ].join('\n');
  }

  function getAnthropicWebsiteStageEffort(stage = 'build') {
    const envKey =
      stage === 'blueprint'
        ? 'ANTHROPIC_WEBSITE_BLUEPRINT_EFFORT'
        : stage === 'review'
          ? 'ANTHROPIC_WEBSITE_REVIEW_EFFORT'
          : 'ANTHROPIC_WEBSITE_BUILD_EFFORT';
    const raw = normalizeString(env[envKey] || '').toLowerCase();
    if (['low', 'medium', 'high', 'max'].includes(raw)) return raw;
    if (stage === 'blueprint') return 'medium';
    if (stage === 'review') return 'medium';
    return 'high';
  }

  function getAnthropicWebsiteStageMaxTokens(stage = 'build') {
    const envKey =
      stage === 'blueprint'
        ? 'ANTHROPIC_WEBSITE_BLUEPRINT_MAX_TOKENS'
        : stage === 'review'
          ? 'ANTHROPIC_WEBSITE_REVIEW_MAX_TOKENS'
          : 'ANTHROPIC_WEBSITE_MAX_TOKENS';
    const fallback = stage === 'blueprint' ? 6000 : stage === 'review' ? 8000 : 12000;
    return Math.max(2000, Math.min(48000, Number(env[envKey] || fallback) || fallback));
  }

  function supportsAnthropicAdaptiveThinking(model = '') {
    const enabled = /^(1|true|yes)$/i.test(String(env.ANTHROPIC_WEBSITE_ENABLE_ADAPTIVE_THINKING || ''));
    if (!enabled) return false;
    const key = normalizeString(model).toLowerCase();
    return key.includes('claude-opus-4-6') || key.includes('claude-sonnet-4-6');
  }

  return {
    buildAnthropicWebsiteHtmlPrompts,
    buildLocalWebsiteBlueprint,
    buildWebsiteGenerationContext,
    buildWebsiteGenerationPrompts,
    buildWebsitePreviewDesignDnaFromScan,
    buildWebsitePreviewBriefFromScan,
    buildWebsitePreviewDownloadFileName,
    buildWebsitePreviewPromptFromScan,
    formatWebsitePreviewDesignDnaLock,
    ensureHtmlDocument,
    ensureStrictAnthropicHtml,
    extractVisibleTextFromHtml,
    getAnthropicWebsiteStageEffort,
    getAnthropicWebsiteStageMaxTokens,
    inferWebsiteIndustryProfile,
    isLikelyUsableWebsiteHtml,
    stripHtmlCodeFence,
    supportsAnthropicAdaptiveThinking,
  };
}

module.exports = {
  createWebsiteGenerationHelpers,
};
