const DEFAULT_COMMERCIAL_TARGETS = Object.freeze([
  '/website-laten-maken',
  '/ai-automatisering',
  '/bedrijfssoftware-op-maat',
  '/crm-systeem-op-maat',
  '/chatbot-laten-maken',
  '/ai-telefonist',
  '/voicesoftware-op-maat',
  '/diensten',
  '/pakketten',
]);

const DEFAULT_MONEY_PAGE_INCOMING_REQUIREMENTS = Object.freeze({
  '/diensten': 8,
  '/website-laten-maken': 8,
  '/ai-automatisering': 8,
  '/bedrijfssoftware-op-maat': 8,
  '/crm-systeem-op-maat': 6,
  '/chatbot-laten-maken': 6,
  '/ai-telefonist': 5,
  '/voicesoftware-op-maat': 5,
  '/pakketten': 5,
});

const DEFAULT_MIN_CONTENT_WORDS_BY_COLLECTION = Object.freeze({
  blog: 900,
  kennisbank: 650,
  vergelijkingen: 850,
  branches: 700,
  regio: 700,
});

const DEFAULT_UNSUPPORTED_CLAIM_RULES = Object.freeze([
  Object.freeze({
    type: 'guaranteed-seo-or-business-result',
    pattern:
      /\b(?:garande(?:er|ert|ren)|gegarandeerd|garantie)\b.{0,90}\b(?:#?1|nummer\s*1|bovenaan|top\s*3|toppositie|ranking|rankings|google|seo|leads?|aanvragen|omzet|conversie|resultaten?)\b/i,
    message: 'claimt een gegarandeerd SEO-, lead-, omzet- of rankingresultaat.',
  }),
  Object.freeze({
    type: 'absolute-security-or-availability',
    pattern:
      /(?:100%|\b(?:volledig|altijd|nooit|permanent)\b).{0,90}\b(?:veilig|hackvrij|foutloos|storingsvrij|waterdicht|privacyproof|datalekvrij|beschikbaar|correct)\b/i,
    message: 'claimt absolute veiligheid, beschikbaarheid of foutloosheid.',
  }),
  Object.freeze({
    type: 'unsupported-certification-or-partner-claim',
    pattern: /\b(?:iso\s*27001|nen\s*7510|soc\s*2|google\s+partner|meta\s+partner|microsoft\s+partner|gecertificeerd|certified)\b/i,
    message: 'claimt een certificering of officieel partnerschap zonder vast bewijs in de SEO-brondata.',
  }),
  Object.freeze({
    type: 'market-leader-or-number-one-claim',
    pattern:
      /\b(?:softora\s+(?:is|wordt|blijft)\s+(?:de\s+)?(?:grootste|beste|nummer\s*1|marktleider)|(?:de\s+)?(?:grootste|beste)\s+(?:speler|partij|bureau|webbouwer|websitebouwer)|wij\s+verslaan\s+(?:iedereen|alle\s+concurrenten))\b/i,
    message: 'positioneert Softora als grootste, beste, nummer 1 of marktleider zonder bewijs.',
  }),
  Object.freeze({
    type: 'unsupported-scale-proof',
    pattern: /\b(?:meer\s+dan\s+)?\d{2,}\+?\s+(?:klanten|projecten|websites|cases|reviews|bedrijven)\b/i,
    message: 'gebruikt harde aantallen klanten, projecten, websites, cases of reviews zonder bron.',
  }),
  Object.freeze({
    type: 'regulated-advice-claim',
    pattern: /\b(?:medisch|juridisch|fiscaal|belasting|beleggings|financieel)\s+advies\b/i,
    message: 'claimt gereguleerd advies dat niet bij Softora’s dienstverlening hoort.',
  }),
  Object.freeze({
    type: 'unbounded-ai-claim',
    pattern: /\bAI\b.{0,90}\b(?:neemt\s+alle\s+beslissingen|vervangt\s+alle\s+medewerkers|maakt\s+geen\s+fouten|is\s+altijd\s+correct)\b/i,
    message: 'doet een te absolute claim over AI zonder menselijke controle of grenzen.',
  }),
  Object.freeze({
    type: 'frontstage-private-founder-name',
    pattern: /\bServ[eé]\s+Creusen\b/i,
    message: 'noemt Servé Creusen in publieke SEO-content terwijl de voorkant op Martijn/Softora moet leunen.',
  }),
]);

function normalizeInternalPath(valueRaw) {
  const raw = String(valueRaw || '').trim();
  if (!raw || raw.startsWith('#')) return '';
  if (/^(mailto|tel|sms|javascript|data):/i.test(raw)) return '';

  let pathName = raw;
  try {
    const parsed = new URL(raw, 'https://www.softora.nl');
    if (parsed.origin !== 'https://www.softora.nl') return '';
    pathName = parsed.pathname;
  } catch {
    pathName = raw.split('?')[0].split('#')[0];
  }

  if (!pathName.startsWith('/')) return '';
  pathName = pathName.replace(/\/{2,}/g, '/');
  if (pathName.length > 1) pathName = pathName.replace(/\/+$/, '');
  return pathName || '/';
}

function extractInternalLinksFromHtml(htmlRaw) {
  return Array.from(String(htmlRaw || '').matchAll(/href=["']([^"']+)["']/gi))
    .map((match) => normalizeInternalPath(match[1]))
    .filter(Boolean);
}

function extractImageEntriesFromHtml(htmlRaw) {
  return Array.from(String(htmlRaw || '').matchAll(/<img\b([^>]*)>/gi)).map((match) => {
    const attrs = match[1] || '';
    const src = attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1] || '';
    const alt = attrs.match(/\balt=["']([^"']*)["']/i)?.[1] || '';
    return {
      src: String(src).trim(),
      alt: String(alt).trim(),
    };
  });
}

function buildSeoLinkGraph(pagesRaw = []) {
  const pages = Array.isArray(pagesRaw) ? pagesRaw : [];
  const publicPaths = new Set(pages.map((page) => normalizeInternalPath(page.path)).filter(Boolean));
  const outgoingByPath = new Map();
  const incomingByPath = new Map();

  for (const pathName of publicPaths) {
    outgoingByPath.set(pathName, new Set());
    incomingByPath.set(pathName, new Set());
  }

  for (const page of pages) {
    const sourcePath = normalizeInternalPath(page.path);
    if (!sourcePath || !publicPaths.has(sourcePath)) continue;

    for (const targetPath of new Set(extractInternalLinksFromHtml(page.html))) {
      if (targetPath === sourcePath || !publicPaths.has(targetPath)) continue;
      outgoingByPath.get(sourcePath).add(targetPath);
      incomingByPath.get(targetPath).add(sourcePath);
    }
  }

  return {
    paths: Array.from(publicPaths).sort(),
    incomingByPath,
    outgoingByPath,
  };
}

function countWords(valueRaw) {
  return String(valueRaw || '').trim().split(/\s+/).filter(Boolean).length;
}

function getItemWordCount(item) {
  if (Number.isFinite(Number(item.wordCount)) && Number(item.wordCount) > 0) {
    return Number(item.wordCount);
  }
  return (item.sections || []).reduce((total, section) => {
    const headingWords = countWords(section.heading);
    const paragraphWords = (section.paragraphs || []).reduce((sum, paragraph) => sum + countWords(paragraph), 0);
    return total + headingWords + paragraphWords;
  }, countWords(item.summary)) + (item.faq || []).reduce((total, entry) => total + countWords(entry.question) + countWords(entry.answer), 0);
}

function getMinimumContentWordCount(item) {
  const collection = String(item && item.collection ? item.collection : '').trim().toLowerCase();
  return DEFAULT_MIN_CONTENT_WORDS_BY_COLLECTION[collection] || 650;
}

function normalizeClaimText(valueRaw) {
  return stripHtmlTags(valueRaw)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectContentItemClaimText(item) {
  const parts = [
    item.title,
    item.description,
    item.category,
    item.intent,
    item.summary,
    ...(Array.isArray(item.sections)
      ? item.sections.flatMap((section) => [
          section.heading,
          ...(Array.isArray(section.paragraphs) ? section.paragraphs : []),
        ])
      : []),
    ...(Array.isArray(item.faq)
      ? item.faq.flatMap((entry) => [entry.question, entry.answer])
      : []),
  ];
  return normalizeClaimText(parts.filter(Boolean).join(' '));
}

function auditTextClaimSafety({ textRaw, pathName, rules = DEFAULT_UNSUPPORTED_CLAIM_RULES } = {}) {
  const text = normalizeClaimText(textRaw);
  const path = normalizeInternalPath(pathName) || String(pathName || '');
  const issues = [];

  if (!text) return issues;

  for (const rule of rules) {
    if (hasUnsupportedClaimMatch(text, rule.pattern)) {
      issues.push({
        type: rule.type,
        path,
        message: `${path || 'Deze publicatie'} ${rule.message}`,
      });
    }
  }

  return issues;
}

function toGlobalPattern(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function isNegatedUnsupportedClaimContext(text, matchIndex, matchText) {
  const contextStart = Math.max(0, matchIndex - 140);
  const contextEnd = Math.min(text.length, matchIndex + String(matchText || '').length + 50);
  const context = text.slice(contextStart, contextEnd).toLowerCase();

  return (
    /\bgarande(?:er|ert|ren)\s+(?:niet|geen)\b/i.test(context) ||
    /\bgeen\s+(?:enkel|garantie|volledige|permanente)\b/i.test(context) ||
    /\bniet\s+(?:altijd|volledig|permanent|foutloos|veilig|correct|beschikbaar|zonder)\b/i.test(context) ||
    /\bzonder\s+garantie\b/i.test(context)
  );
}

function hasUnsupportedClaimMatch(text, pattern) {
  const matcher = toGlobalPattern(pattern);
  for (const match of text.matchAll(matcher)) {
    if (!isNegatedUnsupportedClaimContext(text, match.index || 0, match[0])) {
      return true;
    }
  }
  return false;
}

function auditClaimSafety({ items = [], pages = [], rules = DEFAULT_UNSUPPORTED_CLAIM_RULES } = {}) {
  const issues = [];

  for (const item of Array.isArray(items) ? items : []) {
    const pathName = normalizeInternalPath(`/${item.collection || ''}/${item.slug || ''}`);
    issues.push(
      ...auditTextClaimSafety({
        textRaw: collectContentItemClaimText(item),
        pathName,
        rules,
      })
    );
  }

  for (const page of Array.isArray(pages) ? pages : []) {
    issues.push(
      ...auditTextClaimSafety({
        textRaw: page.html || page.text || '',
        pathName: page.path,
        rules,
      })
    );
  }

  return issues;
}

function auditContentQuality({ items = [], clusters = [], commercialTargets = DEFAULT_COMMERCIAL_TARGETS } = {}) {
  const issues = [];
  const seenPaths = new Set();
  const clusterKeys = new Set(clusters.map((cluster) => String(cluster.key || '').trim()).filter(Boolean));
  const targetSet = new Set(commercialTargets.map(normalizeInternalPath).filter(Boolean));

  for (const item of Array.isArray(items) ? items : []) {
    const pathName = normalizeInternalPath(`/${item.collection || ''}/${item.slug || ''}`);
    const relatedLinks = Array.isArray(item.relatedLinks) ? item.relatedLinks : [];
    const relatedTargets = relatedLinks.map((link) => normalizeInternalPath(link.href)).filter(Boolean);
    const pageLabel = pathName || item.slug || item.title || 'onbekende content';

    if (!pathName || seenPaths.has(pathName)) {
      issues.push({ type: 'duplicate-path', path: pathName, message: `${pageLabel} heeft geen uniek pad.` });
    }
    seenPaths.add(pathName);

    if (String(item.title || '').trim().length < 20) {
      issues.push({ type: 'thin-title', path: pathName, message: `${pageLabel} heeft een te zwakke titel.` });
    }
    if (String(item.description || '').trim().length < 80) {
      issues.push({ type: 'thin-description', path: pathName, message: `${pageLabel} heeft een te korte meta description.` });
    }
    if ((item.sections || []).length < 3) {
      issues.push({ type: 'thin-sections', path: pathName, message: `${pageLabel} heeft minder dan drie inhoudsblokken.` });
    }
    const wordCount = getItemWordCount(item);
    const minWordCount = getMinimumContentWordCount(item);
    if (wordCount < minWordCount) {
      issues.push({
        type: 'thin-body',
        path: pathName,
        message: `${pageLabel} heeft ${wordCount} woorden; minimaal ${minWordCount} verwacht voor deze contentlaag.`,
      });
    }
    if (!item.author || !item.reviewedBy) {
      issues.push({ type: 'missing-eeat', path: pathName, message: `${pageLabel} mist auteur of inhoudelijke controle.` });
    }
    if (!Array.isArray(item.faq) || item.faq.length < 3) {
      issues.push({ type: 'missing-faq-depth', path: pathName, message: `${pageLabel} mist FAQ-verdieping.` });
    }
    if (relatedLinks.length < 3) {
      issues.push({ type: 'weak-related-links', path: pathName, message: `${pageLabel} heeft te weinig interne links.` });
    }
    if (!relatedTargets.every(Boolean) || relatedTargets.length !== relatedLinks.length) {
      issues.push({ type: 'invalid-related-link', path: pathName, message: `${pageLabel} bevat een ongeldige interne link.` });
    }
    if (!relatedTargets.some((href) => targetSet.has(href))) {
      issues.push({ type: 'missing-commercial-link', path: pathName, message: `${pageLabel} linkt niet naar een money page.` });
    }
    if (!clusterKeys.has(String(item.cluster || '').trim())) {
      issues.push({ type: 'missing-cluster', path: pathName, message: `${pageLabel} hangt niet aan een bekend SEO-cluster.` });
    }
  }

  return [...issues, ...auditClaimSafety({ items })];
}

function auditLinkGraph({ graph, requiredIncoming = DEFAULT_MONEY_PAGE_INCOMING_REQUIREMENTS } = {}) {
  const issues = [];
  if (!graph || !(graph.incomingByPath instanceof Map)) {
    return [{ type: 'missing-link-graph', path: '', message: 'De interne linkgraph ontbreekt.' }];
  }

  for (const [pathRaw, minimumRaw] of Object.entries(requiredIncoming || {})) {
    const pathName = normalizeInternalPath(pathRaw);
    const minimum = Number(minimumRaw) || 0;
    const incomingCount = graph.incomingByPath.get(pathName)?.size || 0;
    if (incomingCount < minimum) {
      issues.push({
        type: 'weak-money-page-internal-links',
        path: pathName,
        message: `${pathName} heeft ${incomingCount} interne ingangen, minimaal ${minimum} verwacht.`,
      });
    }
  }

  return issues;
}

function isConversionHref(hrefRaw) {
  const href = String(hrefRaw || '').trim();
  if (/^https:\/\/wa\.me\/31643262792(?:[?#].*)?$/i.test(href)) return true;
  if (/^https:\/\/api\.whatsapp\.com\/send\?phone=31643262792\b/i.test(href)) return true;
  if (/^mailto:/i.test(href)) return true;
  if (/^tel:/i.test(href)) return true;
  return href === '#contact' || href === '/#contact' || href.endsWith('/#contact');
}

function isMartijnWhatsappHref(hrefRaw) {
  const href = String(hrefRaw || '').trim();
  return /^https:\/\/wa\.me\/31643262792(?:[?#].*)?$/i.test(href);
}

function stripHtmlTags(valueRaw) {
  return String(valueRaw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLeadCtaLabel(labelRaw) {
  const label = stripHtmlTags(labelRaw).toLowerCase();
  return /\b(neem contact op|contact opnemen|contact|stuur (?:een )?bericht|verstuur(?: bericht)?|whatsapp|start gesprek|plan gesprek|plan scan|vraag advies|offerte(?: aanvragen)?|bel direct|start project|pakket aanvragen|meer informatie|bespreken)\b/i.test(label);
}

function extractAnchorEntries(htmlRaw) {
  return Array.from(String(htmlRaw || '').matchAll(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)).map(
    (match) => ({
      attrs: match[1] || '',
      href: match[2] || '',
      label: stripHtmlTags(match[3] || ''),
    })
  );
}

function extractButtonEntries(htmlRaw) {
  return Array.from(String(htmlRaw || '').matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)).map((match) => {
    const attrs = match[1] || '';
    const ariaLabel = attrs.match(/\baria-label=["']([^"']+)["']/i)?.[1] || '';
    const title = attrs.match(/\btitle=["']([^"']+)["']/i)?.[1] || '';
    return {
      attrs,
      label: stripHtmlTags(match[2] || '') || stripHtmlTags(ariaLabel || title),
    };
  });
}

function hasSafeBlankTarget(attrsRaw) {
  const attrs = String(attrsRaw || '');
  const target = attrs.match(/(?:^|\s)target=["']([^"']+)["']/i)?.[1] || '';
  const rel = attrs.match(/(?:^|\s)rel=["']([^"']+)["']/i)?.[1] || '';
  return target.toLowerCase() === '_blank' && /\bnoopener\b/i.test(rel) && /\bnoreferrer\b/i.test(rel);
}

function isTrackedWhatsappButton(button) {
  const attrs = String(button?.attrs || '');
  return (
    /data-softora-conversion=["'][^"']+["']/i.test(attrs) &&
    /data-softora-conversion-target=["']whatsapp["']/i.test(attrs)
  );
}

function auditConversionCtas({ pages = [] } = {}) {
  const issues = [];

  for (const page of Array.isArray(pages) ? pages : []) {
    const pathName = normalizeInternalPath(page.path);
    const html = String(page.html || '');
    const anchors = extractAnchorEntries(html);
    const buttons = extractButtonEntries(html);
    const conversionLinks = anchors.filter((anchor) => isConversionHref(anchor.href));
    const annotatedLinks = conversionLinks.filter((anchor) => /data-softora-conversion=["'][^"']+["']/i.test(anchor.attrs));
    const leadCtaButtons = buttons.filter((button) => isLeadCtaLabel(button.label));
    const trackedWhatsappButtons = leadCtaButtons.filter(isTrackedWhatsappButton);

    if (conversionLinks.length === 0 && trackedWhatsappButtons.length === 0) {
      issues.push({ type: 'missing-conversion-link', path: pathName, message: `${pathName} heeft geen meetbare CTA-route.` });
    }
    const nonWhatsappLinks = conversionLinks.filter((anchor) => !isMartijnWhatsappHref(anchor.href));
    if (nonWhatsappLinks.length > 0) {
      issues.push({
        type: 'non-whatsapp-conversion-link',
        path: pathName,
        message: `${pathName} heeft een contact-CTA die niet naar Martijns WhatsApp leidt.`,
      });
    }
    const unsafeWhatsappLinks = conversionLinks.filter(
      (anchor) => isMartijnWhatsappHref(anchor.href) && !hasSafeBlankTarget(anchor.attrs)
    );
    if (unsafeWhatsappLinks.length > 0) {
      issues.push({
        type: 'whatsapp-link-missing-new-tab-safety',
        path: pathName,
        message: `${pathName} heeft een WhatsApp-link zonder target="_blank" en veilige rel-attributen.`,
      });
    }
    const leadCtaLinks = anchors.filter((anchor) => isLeadCtaLabel(anchor.label));
    const nonWhatsappLeadCtas = leadCtaLinks.filter((anchor) => !isMartijnWhatsappHref(anchor.href));
    if (nonWhatsappLeadCtas.length > 0) {
      issues.push({
        type: 'lead-cta-not-whatsapp',
        path: pathName,
        message: `${pathName} heeft een leadknop die niet naar Martijns WhatsApp leidt.`,
      });
    }
    const nonWhatsappLeadButtons = leadCtaButtons.filter((button) => !isTrackedWhatsappButton(button));
    if (nonWhatsappLeadButtons.length > 0) {
      issues.push({
        type: 'lead-button-not-whatsapp',
        path: pathName,
        message: `${pathName} heeft een zichtbare leadknop zonder meetbare WhatsApp-route naar Martijn.`,
      });
    }
    if (annotatedLinks.length !== conversionLinks.length) {
      issues.push({ type: 'untracked-conversion-link', path: pathName, message: `${pathName} heeft CTA-links zonder meetlabel.` });
    }
  }

  return issues;
}

function auditSeoImages({ pages = [] } = {}) {
  const issues = [];

  for (const page of Array.isArray(pages) ? pages : []) {
    const pathName = normalizeInternalPath(page.path);
    const html = String(page.html || '');
    const images = extractImageEntriesFromHtml(html);
    const seoImages = images.filter((image) => String(image.src || '').startsWith('/assets/seo-content/'));

    if (/<div\s+class=["']artikel-img["'][^>]*>/i.test(html) || /blog-card-img[^>]+style=["'][^"']*gradient/i.test(html)) {
      issues.push({
        type: 'legacy-image-placeholder',
        path: pathName,
        message: `${pathName} gebruikt nog een oude tekst- of gradient-placeholder in plaats van een echte foto.`,
      });
    }

    if (seoImages.length === 0) {
      issues.push({ type: 'missing-seo-image', path: pathName, message: `${pathName} heeft geen SEO-foto.` });
      continue;
    }

    for (const image of seoImages) {
      const src = String(image.src || '');
      const alt = String(image.alt || '');
      const fileName = src.split('/').pop() || '';

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-softora\.jpg$/.test(fileName)) {
        issues.push({
          type: 'weak-image-filename',
          path: pathName,
          message: `${pathName} gebruikt geen beschrijvende SEO-bestandsnaam voor ${src}.`,
        });
      }
      if (alt.length < 55 || /placeholder|binnenkort|foto|image|afbeelding/i.test(alt)) {
        issues.push({
          type: 'weak-image-alt',
          path: pathName,
          message: `${pathName} heeft een te zwakke alt-tekst voor ${src}.`,
        });
      }
    }
  }

  return issues;
}

module.exports = {
  DEFAULT_COMMERCIAL_TARGETS,
  DEFAULT_MIN_CONTENT_WORDS_BY_COLLECTION,
  DEFAULT_MONEY_PAGE_INCOMING_REQUIREMENTS,
  DEFAULT_UNSUPPORTED_CLAIM_RULES,
  auditClaimSafety,
  auditContentQuality,
  auditConversionCtas,
  auditLinkGraph,
  auditSeoImages,
  isMartijnWhatsappHref,
  isLeadCtaLabel,
  buildSeoLinkGraph,
  extractButtonEntries,
  extractImageEntriesFromHtml,
  extractInternalLinksFromHtml,
  normalizeInternalPath,
};
