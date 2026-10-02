# SEO Solution — landingspagina

Publieke route: `https://www.softora.nl/seo-solution`. De SEO-tegel op `/toekomst` opent deze pagina; de inlogoptie verwijst naar `/seo-login`.

Start vanuit de root van deze werkmap:

```sh
node scripts/preview-seo-solution.js
```

Open http://127.0.0.1:4176/seo-solution. De keuze-pagina staat op /toekomst; de SEO-tegel verwijst naar de nieuwe landing. De preview luistert alleen op localhost en draait geen backend, workers, scans of verzendingen.

De pagina gebruikt vier eigen imagegen-illustraties, lokale fonts, een toegankelijke interactieve demo, een mobiel menu en native uitklapbare vragen. Afbeeldingen staan in `images/`; de gebruikte prompts zijn opgeslagen in `docs/design/seo-solution-image-prompts.md`.

De contactknoppen verwijzen naar het bestaande Softora-contactformulier. Prijzen, claims en definitieve productdetails kunnen in een volgende ontwerpronde worden aangescherpt.
