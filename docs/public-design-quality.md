# Softora Public Design Quality

Deze checklist geldt voor publieke klant- en SEO-pagina's. Het doel is simpel:
Softora moet betrouwbaar, scherp en premium voelen. SEO mag nooit zichtbaar als
SEO-truc op de pagina landen.

## Vaste uitgangspunten

- Bestaande templates en secties zijn leidend. Gebruik Softora typografie en
  bestaande secties als bron van waarheid.
- Homepage-inhoud en homepage-layout blijven met rust. Alleen footerwerk is
  toegestaan als dat expliciet nodig is.
- Geen premium/admin/slot-uitstraling op publieke pagina's.
- Geen losse SEO-blokken onder of boven de footer. Links horen in echte
  content, navigatie of bestaande footerstructuur, niet in losse linkblokken.
- Geen interne planningscopy zoals "komt later", "SEO-machine", "contentlaag
  krijgt straks" of tekst die aan Codex/Serve gericht is.

## Beeldkwaliteit

Elke nieuwe publieke pagina of publicatie met een beeldvlak moet een echt
beeldplan hebben.

- Gebruik een bestaand goedgekeurd realistisch beeld, of genereer een nieuw
  beeld via de image generation workflow.
- Keur gegenereerde beelden streng af als ze nep, plastic, computerachtig,
  te glad, stockachtig, onrealistisch, ongemakkelijk of laag-vertrouwen voelen.
- Beelden moeten spontaan, realistisch, professioneel en niet duidelijk
  gegenereerd aanvoelen.
- Geen gradient-only placeholders, lege image boxes, "foto volgt later" blokken
  of decoratieve nepvisuals op klantgerichte pagina's.
- Bestandsnamen zijn beschrijvend en SEO-vriendelijk, bijvoorbeeld
  `ai-automatisering-workflow-softora.jpg`.
- Elke afbeelding krijgt een betekenisvolle alt-tekst die uitlegt wat relevant
  is voor de pagina.
- Afbeeldingen krijgen vaste `width` en `height` waar praktisch, zodat de layout
  niet springt.
- Voeg schema `image` toe waar de bestaande SEO/contentlaag dat ondersteunt.

## Designchecks

Controleer bij nieuwe of aangepaste publieke pagina's minimaal:

- Hero-titel heeft genoeg breedte en breekt niet onnodig in te veel regels.
- Belangrijke CTA's zijn echte knoppen of duidelijk herkenbare links.
- Contrast is sterk genoeg, vooral op donkere hero-afbeeldingen.
- Tekst en knoppen overlappen niet op mobiel of desktop.
- Geen horizontale overflow.
- Cards, secties en footer voelen als een logisch geheel, niet als losse
  aangeplakte SEO-onderdelen.
- Interne links staan natuurlijk in de flow van de pagina.

## PR-regel

Een PR voor nieuwe publieke content is pas klaar als tekst, links, metadata,
beeldkwaliteit, alt-teksten en visuele checks samen kloppen. Bij twijfel over
beelden: niet mergen, maar vervangen of open laten voor review.

## Herstelproces

- Werk vanaf de nieuwste `main` op een kleine `codex/*` branch.
- Repareer designproblemen bij voorkeur in gedeelde CSS, templates of
  content-metadata, niet met pagina-specifieke lapmiddelen.
- Houd PR's klein: een zichtbare designfout, beeldkwaliteitfix of gedeelde
  templateverbetering per PR.
- Draai contracttests en `npm run verify:critical`.
- Controleer minimaal desktop en mobiel op de aangepaste publieke pagina.
- Merge pas als checks groen zijn en de pagina live geen visuele regressie of
  laag-vertrouwen beeld toont.
