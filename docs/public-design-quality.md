# Softora Public Design Quality

Deze regels bewaken dat SEO-groei niet ten koste gaat van de uitstraling van de site. Nieuwe pagina's en verbeteringen moeten voelen alsof ze uit dezelfde Softora-template komen, niet alsof er snel een SEO-blok is bijgeplakt.

## Regels

- Bestaande templates en secties zijn leidend. Voeg geen losse one-off blokken toe als een bestaande hero, grid, FAQ, CTA, footer of kaartsectie hetzelfde werk kan doen.
- Homepage-inhoud en homepage-layout blijven met rust. Alleen footer-wijzigingen zijn toegestaan zolang dit expliciet zo is afgesproken.
- Hero-titels moeten genoeg breedte krijgen. Vermijd smalle titelkolommen die korte zinnen onnodig over vier of vijf regels breken.
- CTA's moeten als CTA herkenbaar zijn. Een actie naast een primaire knop mag geen bijna onzichtbare tekstlink zijn.
- Contrast moet op desktop en mobiel zichtbaar blijven, vooral op donkere hero-afbeeldingen.
- Knoppen, links, kaarten en tekst mogen niet overlappen, afbreken of horizontale scroll veroorzaken.
- Geen losse SEO-blokken onder de footer of bovenaan de pagina. SEO-links horen in echte content, bestaande secties of de footer.
- Publieke SEO-pagina's tonen geen premium/admin/slot-uitstraling en geen zichtbare `/premium-*` service-links.
- Bij twijfel: minder toevoegen, beter plaatsen. Een compacte, logische pagina is sterker dan een lange pagina met rommelige secties.

## Herstelproces

- Werk vanaf de nieuwste `main` op een kleine `codex/*` branch.
- Repareer designproblemen bij voorkeur in gedeelde CSS of gedeelde templates, niet met pagina-specifieke lapmiddelen.
- Houd PR's klein: een zichtbare designfout of een gedeelde templateverbetering per PR.
- Draai contracttests en `npm run verify:critical`.
- Controleer minimaal desktop en mobiel op de aangepaste publieke pagina.
- Merge pas als checks groen zijn en de pagina live geen visuele regressie toont.
