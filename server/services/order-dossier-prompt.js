function createOrderDossierPromptHelpers(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    clipText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  } = deps;

  function normalizeOrderDossierPromptFragment(value) {
    return clipText(
      normalizeString(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^[,;:.\-\s]+|[,;:.\-\s]+$/g, '')
        .trim(),
      320
    );
  }

  function buildOrderDossierPromptSubject(input) {
    const company = normalizeString(input?.company || '');
    const title = normalizeString(input?.title || '');
    const domainName = normalizeString(input?.domainName || '');
    const parts = [];

    if (company && company.toLowerCase() !== 'onbekend') parts.push(company);
    if (
      title &&
      !/^opdracht #\d+$/i.test(title) &&
      (!company || title.toLowerCase() !== company.toLowerCase())
    ) {
      parts.push(title);
    }
    if (domainName) parts.push(`domein ${domainName}`);

    return parts.length ? parts.join(' - ') : 'deze klant';
  }

  function collectOrderDossierPromptFragments(input) {
    const source = normalizeString([input?.description || '', input?.transcript || ''].filter(Boolean).join('\n'));
    if (!source) return [];

    const wishPattern =
      /\b(website|site|landingspagina|pagina|kleur|kleurenschema|stijl|design|branding|huisstijl|logo|inhoud|functional|functie|formulier|contactformulier|cta|seo|tekst|copy|beeld|foto|video|responsive|mobiel|desktop|meertalig|integrat|agenda|kalender|boeking|reserver|offerte|portfolio|cases|review|testimonial|webshop|shop|afspraakmodule|lead|uitstraling|sfeer|typografie|tone-of-voice|conversie)\b/i;
    const intentPattern = /\b(moet|moeten|wil|willen|wens|wensen|gewenst|graag|nodig|belangrijk|voorkeur)\b/i;
    const ignorePattern =
      /\b(whatsapp|afspraak|aankloppen|aankomst|bevestigd|bevestiging|gepland|datum|tijdstip|tijd|locatie|adres|route|bel aan)\b/i;
    const vaguePattern = /\b(wordt|worden)\s+besproken\b/i;
    const seen = new Set();

    return source
      .replace(/\u2022/g, '\n')
      .replace(/\n\s*[-*]\s+/g, '\n')
      .split(/\n+/)
      .flatMap((line) => String(line || '').split(/[.!?]+\s+/))
      .map((fragment) => normalizeOrderDossierPromptFragment(fragment))
      .filter(Boolean)
      .filter((fragment) => {
        const key = fragment.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        if (vaguePattern.test(fragment)) return false;
        const matchesWish = wishPattern.test(fragment);
        const matchesIntent = intentPattern.test(fragment);
        if (ignorePattern.test(fragment) && !matchesWish) return false;
        return matchesWish || matchesIntent;
      })
      .slice(0, 8);
  }

  function buildShortOrderDossierOpusPrompt(input = {}) {
    const subject = buildOrderDossierPromptSubject(input);
    const wishFragments = collectOrderDossierPromptFragments(input);
    if (!wishFragments.length) {
      return `Bouw een professionele website voor ${subject} op basis van uitsluitend de gekoppelde lead- en dossierinformatie. Verwerk alleen expliciete klantwensen, laat ontbrekende details als TODO of placeholder staan en neem geen interne afspraken of contactlogistiek mee in de build.`;
    }

    const wishSummary = clipText(
      wishFragments
        .map((fragment) => fragment.replace(/[.!?]+$/g, '').trim())
        .filter(Boolean)
        .join('; '),
      1400
    );

    return `Bouw een professionele website voor ${subject} op basis van uitsluitend deze bekende klantwensen: ${wishSummary}. Verwerk alle expliciete inhoudelijke, functionele en visuele wensen uit dit dossier, laat ontbrekende details als TODO of placeholder staan en neem geen interne afspraken of contactlogistiek mee in de build.`;
  }

  return {
    buildShortOrderDossierOpusPrompt,
  };
}

module.exports = {
  createOrderDossierPromptHelpers,
};
