const INTERNE_LINKSTRUCTUUR_CONTENT_ITEM = Object.freeze({
  collection: 'kennisbank',
  slug: 'wat-is-interne-linkstructuur',
  title: 'Wat is een interne linkstructuur?',
  description:
    'Leer hoe je diensten, blogs en kennisbankpagina’s met contextuele interne links verbindt, orphan pages voorkomt en belangrijke pagina’s vindbaar houdt.',
  category: 'Websites',
  intent: 'Uitleg',
  qualityVersion: 2,
  primaryIntent: 'Uitleg en implementatie van een bruikbare interne linkstructuur',
  buyerTask: 'Bepalen welke pagina naar welke dienst of uitleg moet linken en waarom',
  funnelStage: 'consideration',
  targetMoneyPage: '/website-laten-maken',
  uniqueClusterRole:
    'Praktische architectuur- en auditgids voor interne links, los van pagina-opbouw, websitebouw of contentplanning.',
  informationGain:
    'Een controleerbaar model met paginarollen, linkredenen, ankertekst, clusterkaart en een onderhoudsaudit voor nieuwe en bestaande content.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Google Search Central: Link best practices for Google',
      url: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
      observedAt: '2026-07-26',
    }),
    Object.freeze({
      title: 'Google Search Central: What is a sitemap?',
      url: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',
      observedAt: '2026-07-26',
    }),
  ]),
  growthEventKind: 'substantial_refresh',
  growthEventAt: '2026-07-26',
  publishedAt: '2026-06-01',
  updatedAt: '2026-07-26',
  summary:
    'Een interne linkstructuur is het netwerk van klikbare routes tussen pagina’s op dezelfde website. Een goede structuur koppelt iedere belangrijke pagina aan een duidelijke rol, relevante context en een logische volgende stap.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Een interne link is meer dan een menu-item',
      paragraphs: Object.freeze([
        'Een interne link verwijst vanaf een pagina naar een andere pagina binnen hetzelfde domein. Navigatie, breadcrumbs en overzichtspagina’s horen daarbij, maar de sterkste route voor een lezer staat meestal in de inhoud zelf: precies op het moment dat extra uitleg, een vergelijking of een commerciële vervolgstap helpt.',
        'De link heeft daardoor twee taken. Hij voorkomt dat een bezoeker na één antwoord vastloopt en hij maakt de relatie tussen onderwerpen expliciet. Een pagina over CRM-kosten kan bijvoorbeeld doorverwijzen naar implementatie, datakwaliteit en de passende CRM-dienst zonder al die vragen zelf volledig te beantwoorden.',
      ]),
    }),
    Object.freeze({
      heading: 'Geef iedere pagina eerst één duidelijke rol',
      paragraphs: Object.freeze([
        'Begin niet met zoveel mogelijk links, maar met paginarollen. Een money page legt een dienst en contactroute uit. Een kennisbankpagina beantwoordt een afgebakende vraag. Een blog helpt bij een probleem of besluit. Een vergelijking maakt verschillen en niet-passende situaties zichtbaar. Als twee pagina’s dezelfde taak claimen, lossen extra links de overlap niet op.',
        'Schrijf per URL op welke vraag hij als eerste moet beantwoorden, welke vervolgvraag logisch is en naar welke commerciële pagina hij uiteindelijk mag leiden. Zo blijft website laten maken de route voor een websitevraag, bedrijfssoftware op maat de route voor bredere applicaties en CRM op maat de specifieke route voor lead-, klant- en offerteprocessen.',
      ]),
    }),
    Object.freeze({
      heading: 'Bouw een cluster vanuit de taak van de koper',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Kies één centrale dienst en groepeer daaromheen de vragen die iemand vóór contact moet oplossen. Rond bedrijfssoftware zijn dat bijvoorbeeld keuze, kosten, implementatie, migratie, integraties en beheer. De dienstpagina voor bedrijfssoftware op maat hoeft die onderwerpen niet te dupliceren; iedere ondersteunende pagina behandelt één eigen beslissing en verwijst terug wanneer de lezer klaar is voor scope.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'bedrijfssoftware op maat',
              href: '/bedrijfssoftware-op-maat',
            }),
          ]),
        }),
        Object.freeze({
          text:
            'Binnen dat brede softwarecluster verdient CRM een eigen route. Uitleg over eisen, implementatie en kosten kan elkaar ondersteunen, terwijl de commerciële stap naar CRM op maat gaat. Daarmee ontstaat geen willekeurige ketting, maar een beslispad van probleem naar eisen, aanpak en gesprek.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'CRM op maat',
              href: '/crm-systeem-op-maat',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Plaats contextuele links waar de vervolgstap ontstaat',
      paragraphs: Object.freeze([
        'Een rij algemene links onderaan een pagina kan nuttig zijn als extra navigatie, maar vervangt geen link in de uitleg. Zet de link in de alinea waarin de bestemming werkelijk relevant wordt. De omliggende zin moet duidelijk maken waarom iemand doorklikt en wat daar anders of dieper wordt behandeld.',
        Object.freeze({
          text:
            'Gebruik beschrijvende, beknopte ankertekst. “Lees meer” zegt zonder context weinig; “AI-automatisering voor een controleerbare workflow” maakt de bestemming voorspelbaar. Wissel formuleringen alleen wanneer de zin daarom vraagt, niet om geforceerd varianten van hetzelfde zoekwoord te plaatsen.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'AI-automatisering voor een controleerbare workflow',
              href: '/ai-automatisering',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Plan inkomende en uitgaande links tegelijk',
      paragraphs: Object.freeze([
        'Een nieuwe pagina is niet klaar wanneer hij alleen zelf naar andere pagina’s linkt. Bepaal vóór publicatie ook vanaf welke bestaande, vindbare pagina’s een natuurlijke ingang kan komen. Kies bronnen die inhoudelijk aansluiten en voeg geen link toe aan een alinea die over iets anders gaat.',
        Object.freeze({
          text:
            'Voor een websiteonderwerp kan een bestaande uitleg over pagina-opbouw naar deze gids verwijzen, waarna deze gids weer doorstuurt naar een website laten maken wanneer structuur, techniek en conversie samen moeten worden uitgewerkt. Voor software en CRM geldt hetzelfde principe, maar met hun eigen money page en ondersteunende beslisvragen.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'uitleg over pagina-opbouw',
              href: '/blog/website-laten-maken-mkb-paginas',
            }),
            Object.freeze({
              anchor: 'website laten maken',
              href: '/website-laten-maken',
            }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      heading: 'Controleer op orphan pages, doodlopende routes en overlap',
      paragraphs: Object.freeze([
        'Maak periodiek een lijst van alle indexeerbare URL’s en tel per pagina de unieke interne ingangen en uitgangen. Een orphan page heeft geen bruikbare interne ingang. Een doodlopende pagina geeft de lezer geen relevante volgende stap. Een pagina met veel links kan nog steeds zwak zijn wanneer alle links alleen uit een generiek menu of hetzelfde herhaalde blok komen.',
        'Bekijk daarna de inhoudelijke buren. Vergelijk titel, hoofdvraag, koppen en commerciële bestemming. Wanneer twee pagina’s vrijwel hetzelfde besluit behandelen, kies dan een duidelijke hoofd-URL, voeg unieke onderdelen samen en stuur interne links naar die bestemming. Behoud beide pagina’s alleen als hun zoekintentie en taak aantoonbaar verschillen.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik een kleine linkkaart vóór publicatie',
      paragraphs: Object.freeze([
        'Een praktische linkkaart heeft vijf regels: de URL en primaire taak; de centrale money page; minimaal twee inhoudelijk passende uitgaande links; minimaal twee bestaande pagina’s die een ingang kunnen geven; en de ankertekst plus reden voor iedere link. Controleer ook of alle bestemmingen publiek, indexeerbaar, zelf-canoniek en daadwerkelijk live zijn.',
        'Deze kaart voorkomt twee uitersten: een pagina die los in de sitemap staat en een pagina die naar bijna alles verwijst. Niet ieder artikel hoeft het hele cluster te verbinden. Het moet vooral de route ondersteunen die voor die specifieke lezer op dat moment logisch is.',
      ]),
    }),
    Object.freeze({
      heading: 'Onderhoud de structuur na wijzigingen en consolidaties',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Controleer interne links opnieuw wanneer een URL wijzigt, pagina’s worden samengevoegd of een nieuw artikel een bestaande taak overneemt. Werk oude ankerteksten en bestemmingen bij, voorkom redirectketens en laat sitemap, canonical en zichtbare navigatie dezelfde voorkeurs-URL aanwijzen. Gebruik bij een website-migratie een vaste URL-kaart zodat iedere oude ingang één aantoonbare bestemming krijgt.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'website-migratie',
              href: '/kennisbank/website-migratie-zonder-seo-verlies',
              availableFrom: '2026-08-26',
            }),
          ]),
        }),
        'Kijk na publicatie naar crawl- en indexatiesignalen, vertoningen, doorklikken naar money pages en echte contactacties voor zover die betrouwbaar gemeten worden. Een interne link kan ontdekking en begrip ondersteunen, maar garandeert geen indexatie of ranking. Als een pagina onbekend of niet geïndexeerd blijft, onderzoek dan ook inhoudelijke uniekheid, technische signalen en overlap voordat je simpelweg meer links toevoegt.',
      ]),
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
    Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
    Object.freeze({ label: 'CRM systeem op maat', href: '/crm-systeem-op-maat' }),
    Object.freeze({ label: 'AI automatisering', href: '/ai-automatisering' }),
    Object.freeze({ label: 'MKB website pagina’s', href: '/blog/website-laten-maken-mkb-paginas' }),
  ]),
});

module.exports = {
  INTERNE_LINKSTRUCTUUR_CONTENT_ITEM,
};
