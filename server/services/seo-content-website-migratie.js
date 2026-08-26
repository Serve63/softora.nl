const WEBSITE_MIGRATIE_CONTENT_ITEM = Object.freeze({
  collection: 'kennisbank',
  slug: 'website-migratie-zonder-seo-verlies',
  title: 'Website migreren: beperk SEO-verlies met een controleerbaar plan',
  description:
    'Migreer een website met een URL-inventaris, redirectmap, canonicals, interne links, sitemapcontroles en een herstelplan voor de periode na livegang.',
  category: 'Websites',
  intent: 'Implementatie',
  qualityVersion: 2,
  primaryIntent: 'Een website migreren met behoud van vindbaarheid en controle over technische signalen',
  buyerTask:
    'Voor iedere oude URL vooraf een bestemming en controlebewijs vastleggen, de livegang begrenzen en afwijkingen na publicatie gericht herstellen',
  funnelStage: 'consideration',
  targetMoneyPage: '/website-laten-maken',
  uniqueClusterRole:
    'Migratie- en herstelgids voor URL-wijzigingen, redirects en zoeksignalen; de paginagids bepaalt de inhoudsstructuur en de interne-linkgids het blijvende linknetwerk.',
  informationGain:
    'Een uitvoerbare migratiekaart per URL met oude bestemming, nieuwe bestemming, besluitreden, redirecttype, interne ingangen, canonical, sitemapstatus, eigenaar, livebewijs en herstelactie.',
  sources: Object.freeze([
    Object.freeze({
      title: 'Google Search Central: Site moves with URL changes',
      url: 'https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes',
      observedAt: '2026-08-26',
    }),
    Object.freeze({
      title: 'Google Search Central: Redirects and Google Search',
      url: 'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
      observedAt: '2026-08-26',
    }),
    Object.freeze({
      title: 'Google Search Central: Canonicalization',
      url: 'https://developers.google.com/search/docs/crawling-indexing/canonicalization',
      observedAt: '2026-08-26',
    }),
    Object.freeze({
      title: 'Google Search Central: Build and submit a sitemap',
      url: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
      observedAt: '2026-08-26',
    }),
  ]),
  growthEventKind: 'new_url',
  growthEventAt: '2026-08-26',
  publishedAt: '2026-08-26',
  updatedAt: '2026-08-26',
  summary:
    'Een website-migratie verplaatst inhoud, techniek of URL’s naar een nieuwe situatie. Je kunt tijdelijke schommelingen niet uitsluiten, maar je kunt zoekmachines en bezoekers wel één consistente route geven en iedere afwijking herleidbaar maken.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'Begin met de eerlijke grens: nul SEO-verlies is geen belofte',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Bij een migratie veranderen vaak URL’s, templates, navigatie, inhoud of hosting tegelijk. Zoekmachines moeten die nieuwe situatie opnieuw crawlen en verwerken. Daardoor kunnen posities en vertoningen tijdelijk schommelen, ook wanneer de uitvoering zorgvuldig is. Een website laten maken met migratieverantwoordelijkheid hoort daarom niet alleen een ontwerp- en bouwscope te hebben, maar ook een inventaris, redirectplan, validatie en herstelperiode.',
          links: Object.freeze([
            Object.freeze({ anchor: 'website laten maken', href: '/website-laten-maken' }),
          ]),
        }),
        'Het doel is niet om ieder verschil te vermijden. Het doel is dat voor iedere bestaande pagina vooraf duidelijk is wat ermee gebeurt, dat oude en nieuwe signalen dezelfde voorkeurs-URL aanwijzen en dat het team na livegang kan zien of een afwijking technisch, inhoudelijk of meetkundig is. Zonder die basis wordt een daling al snel aan het redesign toegeschreven terwijl bijvoorbeeld redirects ontbreken, analytics niet meet of belangrijke tekst is verdwenen.',
      ]),
    }),
    Object.freeze({
      heading: 'Bevries eerst de uitgangssituatie',
      paragraphs: Object.freeze([
        'Maak vóór de bouw een reproduceerbare momentopname. Verzamel alle indexeerbare URL’s uit de huidige sitemap, interne crawl, analytics en Search Console. Noteer per URL de statuscode, canonical, titel, hoofdonderwerp, belangrijkste interne ingangen, organische landingen en relevante conversieroute voor zover die betrouwbaar wordt gemeten. Bewaar ook robotsregels, sitemaps en redirects die nu al actief zijn.',
        'De momentopname voorkomt dat alleen de zichtbare navigatie wordt gemigreerd. Oude campagnepagina’s, kennisbankartikelen en URL’s die niet meer in het menu staan, kunnen nog backlinks, zoekverkeer of klantfavorieten hebben. Neem een URL niet automatisch mee omdat hij bestaat, maar verwijder hem evenmin omdat niemand hem tijdens een vergadering noemt. De data-eigenaar en inhoudseigenaar moeten samen besluiten of de taak blijft, wordt samengevoegd of echt verdwijnt.',
        'Leg daarnaast een meetbaseline vast zonder daar een garantie van te maken: organische klikken en vertoningen per paginagroep, indexatiestatus van prioriteitspagina’s, crawlproblemen en geldige contactgebeurtenissen. Controleer of meetcodes en toestemmingsinstellingen op de huidige site werkelijk events leveren. Een kapotte nulmeting wordt na livegang geen betrouwbare vergelijking door hem alsnog in een dashboard te zetten.',
      ]),
    }),
    Object.freeze({
      heading: 'Geef iedere oude URL precies één besluit',
      paragraphs: Object.freeze([
        'Bouw een migratiekaart met minimaal deze kolommen: oude URL, huidige taak, nieuwe URL, besluit, reden, redirecttype, canonical, interne ingangen, sitemapstatus, eigenaar en acceptatiebewijs. Gebruik voor het besluit een beperkte set: behouden, verplaatsen, samenvoegen of verwijderen. Zo voorkom je vrije notities als “later bekijken” die op de livegang alsnog in redirects of 404’s moeten worden vertaald.',
        'Bij behouden blijft de URL gelijk en controleer je of de inhoudelijke taak niet ongemerkt verandert. Bij verplaatsen krijgt de oude URL één permanente redirect naar de inhoudelijk equivalente nieuwe URL. Bij samenvoegen moet de bestemming de nuttige taak van de oude pagina werkelijk overnemen. Bij verwijderen is alleen een 404 of 410 passend wanneer er geen relevante vervanger bestaat; alles naar de homepage sturen maakt de bestemming niet logisch.',
        'Neem taal-, parameter-, slash- en protocolvarianten mee wanneer die publiek bereikbaar zijn. Kies één voorkeursvorm en test ook de varianten die gebruikers of zoekmachines nog kunnen aanroepen. De kaart is pas compleet wanneer iedere oude route een voorspelbare uitkomst heeft en de nieuwe route zelf publiek bereikbaar kan worden gecontroleerd.',
      ]),
    }),
    Object.freeze({
      heading: 'Gebruik redirects als route, niet als opruimlaag',
      paragraphs: Object.freeze([
        'Een permanente serverredirect is geschikt wanneer een URL duurzaam naar een nieuwe locatie verhuist. Laat de oude URL rechtstreeks naar de uiteindelijke bestemming wijzen. Een keten van oud naar tijdelijk naar nieuw vertraagt de route, maakt beheer lastiger en kan later breken wanneer een tussenstap wordt verwijderd. Controleer dus niet alleen of er een redirect is, maar ook hoeveel stappen volgen en waar de laatste respons eindigt.',
        'Maak de bestemming op taakniveau gelijkwaardig. Een oud artikel over websitekosten hoort niet automatisch naar een algemene dienstenpagina wanneer een actuele kostengids bestaat. Een verwijderde vacature naar contact sturen is evenmin vanzelfsprekend. De juiste vraag is: kan iemand die de oude URL opent op de bestemming dezelfde informatie of een eerlijk vervolg vinden?',
        'Test de volledige redirectmap geautomatiseerd én met een steekproef in de browser. Controleer statuscode, eind-URL, protocol, host, querygedrag en een lusvrije route. Laat afwijkingen een eigenaar en hersteldeadline krijgen. Een spreadsheet met groen gemarkeerde regels is geen bewijs wanneer de productieomgeving andere regels of een CDN-laag gebruikt.',
      ]),
    }),
    Object.freeze({
      heading: 'Laat canonical, interne links en sitemap hetzelfde verhaal vertellen',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Redirects repareren oude ingangen, maar nieuwe pagina’s horen direct naar de voorkeurs-URL te linken. Werk navigatie, breadcrumbs, contextuele links, hreflang waar dat bestaat en verwijzingen in templates bij. Een goede interne linkstructuur voorkomt dat bezoekers en crawlers eerst door oude URL’s of redirectketens lopen.',
          links: Object.freeze([
            Object.freeze({ anchor: 'interne linkstructuur', href: '/kennisbank/wat-is-interne-linkstructuur' }),
          ]),
        }),
        'Zet op iedere indexeerbare nieuwe pagina een self-canonical naar de gekozen publieke URL. Controleer dat protocol, domein, pad en slashconventie exact overeenkomen met redirects en interne links. Een canonical is een voorkeursignaal en geen reparatie voor tegenstrijdige techniek. Een pagina die naar A canoniseert, intern als B wordt gelinkt en via de sitemap als C wordt aangeboden, laat het systeem drie verschillende besluiten zien.',
        'Publiceer in de nieuwe sitemap alleen publieke, indexeerbare voorkeurs-URL’s die een succesvolle respons geven. Verwijder oude sitemaplocaties pas nadat de nieuwe situatie is aangeboden en bewaak de verwerking. Controleer robots.txt afzonderlijk: een stagingblokkade die per ongeluk meegaat naar productie kan crawling verhinderen, terwijl een stagingomgeving zonder bescherming juist vroegtijdig kan uitlekken of worden geïndexeerd.',
      ]),
    }),
    Object.freeze({
      heading: 'Scheid inhoudelijke wijzigingen van de technische verhuizing',
      paragraphs: Object.freeze([
        Object.freeze({
          text:
            'Een migratie is al complex genoeg zonder tegelijk ieder onderwerp te herschrijven. Behoud titels, hoofdvragen en bewezen onderdelen wanneer ze nog kloppen. Plan grotere inhoudelijke verbeteringen als aparte beslissing, tenzij samenvoegen of een gewijzigde dienst ze noodzakelijk maakt. De gids over benodigde MKB-websitepagina’s helpt bepalen welke paginarollen in de nieuwe structuur thuishoren; deze migratiegids blijft eigenaar van de overgang tussen oud en nieuw.',
          links: Object.freeze([
            Object.freeze({
              anchor: 'benodigde MKB-websitepagina’s',
              href: '/blog/website-laten-maken-mkb-paginas',
            }),
          ]),
        }),
        'Wanneer inhoud toch verandert, leg dan vast wat is verwijderd, toegevoegd en verplaatst. Vergelijk niet alleen woordenaantallen. Controleer of de primaire taak, essentiële feiten, bewijs, interne routes en commerciële vervolgstap behouden blijven. Een mooiere pagina kan inhoudelijk armer worden als relevante beslisinformatie achter tabs verdwijnt of alleen door scripts na een interactie beschikbaar komt.',
        'Laat een mens per prioriteitspagina accepteren of de nieuwe versie dezelfde of bewust een betere taak uitvoert. Een geautomatiseerde vergelijking kan ontbrekende titels, koppen en links signaleren, maar beoordeelt niet zelfstandig of een nieuwe uitleg voor de koper voldoende is. Die grens hoort expliciet in het migratieplan.',
      ]),
    }),
    Object.freeze({
      heading: 'Maak van livegang een begrensd go-no-go-besluit',
      paragraphs: Object.freeze([
        'Definieer vóór livegang blokkerende controles. Prioriteitspagina’s geven 200, oude URL’s volgen de goedgekeurde map, canonicals zijn zelfverwijzend, robots staat productiecrawling toe, de sitemap bevat de nieuwe voorkeurspaden, formulieren en WhatsApp-routes werken en analytics registreert alleen bevestigde gebeurtenissen. Controleer ook mobiel, structured data, afbeeldingen en de foutpagina.',
        'Wijs per controle een beslisser aan en voorkom dat dezelfde persoon die de wijziging bouwde stilzwijgend alle uitzonderingen accepteert. Kleine cosmetische afwijkingen kunnen soms na livegang worden opgelost; ontbrekende redirects, een geblokkeerde site, foutieve canonicals of een defect contactpad zijn reden om niet door te gaan. Noteer uitzonderingen met eigenaar, risico en exacte herstelactie.',
        'Een rollbackplan zegt vooraf welke technische staat kan worden teruggezet, welke data sinds livegang kan ontstaan en wie de beslissing neemt. Terugrollen is niet altijd de beste SEO-keuze: wanneer URL’s al zijn gecrawld kan opnieuw wisselen extra onduidelijkheid veroorzaken. Gebruik daarom objectieve stopcriteria en laat de technische en inhoudelijke eigenaar samen besluiten, in plaats van bij iedere zichtbare schommeling automatisch terug te gaan.',
      ]),
    }),
    Object.freeze({
      heading: 'Controleer productie op bewijs, niet op verwachting',
      paragraphs: Object.freeze([
        'Crawl na de deploy zowel een set oude URL’s als alle nieuwe prioriteitspagina’s. Vergelijk de uitkomst met de migratiekaart en controleer live HTML, status, canonical, robotsmeta, titel, H1, interne links, schema en sitemap. Controleer formulieren en contactroutes end-to-end zonder van een knopklik al een ontvangen lead te maken. Kijk ook of productie werkelijk de bedoelde release draait; een geslaagde build zegt niets over het actieve domein.',
        'Inspecteer prioriteitspagina’s daarna met Search Console. URL-inspectie toont wat Google van een URL kent, maar is geen verzoek tot indexering. Vraag indexering alleen via de normale Search Console-interface wanneer de pagina live, indexeerbaar, zelf-canoniek en nog niet geïndexeerd is, en leg het resultaat vast. Herhaal geen verzoeken zonder materiële wijziging of passend opvolgmoment.',
        'Maak een herstelwachtrij met URL, signaal, ernst, bewijs, eigenaar en volgende controle. Pak tegenstrijdige canonicals, foutieve redirects, serverfouten en onbereikbare money pages eerst aan. Een losse niet-geïndexeerde pagina kan ook een inhouds- of overlapvraag zijn; meer interne links of opnieuw indienen is niet automatisch de oplossing.',
      ]),
    }),
    Object.freeze({
      heading: 'Beoordeel herstel in cohorten, niet op één dag',
      paragraphs: Object.freeze([
        'Volg de eerste dagen vooral technische bereikbaarheid, crawling, sitemapverwerking en meetcompleetheid. Kijk daarna per paginagroep naar indexatie, niet-merkgebonden vertoningen, klikken en positie. Scheid behouden URL’s, verplaatste URL’s, samengevoegde pagina’s en echt nieuwe pagina’s; hun verwachte verwerking en risico verschillen.',
        'Gebruik veertien dagen als vroeg signaal, achtentwintig dagen voor richting en een langere periode voor sterker bewijs. Vergelijk met de bevroren baseline en houd rekening met seizoen, merkverkeer, campagne-effecten en algemene vraag. Een tijdelijke daling bewijst niet dat één redirect fout is, net zoals herstel na een wijziging geen zekere causaliteit aantoont.',
        'Sluit de migratie pas wanneer de technische wachtrij leeg of bewust geaccepteerd is, prioriteitspagina’s een verklaarde indexatiestatus hebben, meetroutes betrouwbaar zijn en eigenaarschap is overgedragen aan beheer. Daarmee wordt de website geen eenmalig oplevermoment, maar een controleerbaar systeem waarin latere inhoud, techniek en conversieverbeteringen veilig kunnen worden gepland.',
      ]),
    }),
  ]),
  relatedLinks: Object.freeze([
    Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
    Object.freeze({ label: 'Interne linkstructuur', href: '/kennisbank/wat-is-interne-linkstructuur' }),
    Object.freeze({ label: 'Pagina’s voor een MKB-website', href: '/blog/website-laten-maken-mkb-paginas' }),
    Object.freeze({ label: 'Websitekosten en scope', href: '/blog/website-laten-maken-kosten-2026' }),
  ]),
});

module.exports = {
  WEBSITE_MIGRATIE_CONTENT_ITEM,
};
