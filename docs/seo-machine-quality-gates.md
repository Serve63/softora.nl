# Softora SEO Machine Quality Gates

Deze poorten bewaken dat de SEO-machine niet alleen publiceert, maar ook netjes blijft bouwen.

## Wat De Poort Bewaakt

- Contentkwaliteit: iedere live publicatie heeft een duidelijke titel, meta description, minimaal drie inhoudsblokken, genoeg tekst, een bekend cluster en interne links naar money pages.
- Interne linkgraph: belangrijke commerciële pagina's moeten genoeg interne ingangen krijgen vanuit publieke pagina's en content.
- CTA-meetbaarheid: publieke commerciële pagina's en SEO-content krijgen meetlabels op contact- en service-CTA's, zodat we later beter kunnen zien welke pagina's leads helpen maken.
- Afbeeldingen: SEO-content gebruikt echte lokale foto-assets, met beschrijvende alt-teksten en bestandsnamen die het onderwerp en Softora logisch benoemen.
- Schone publieke structuur: content en navigatie gebruiken gewone publieke URL's zoals `/diensten`, `/pakketten`, `/website-laten-maken` en `/ai-automatisering`.
- Homepage-rust: de homepage-content blijft buiten deze poort; alleen footer/SEO-infrastructuur mag daar geraakt worden wanneer dat expliciet nodig is.

## Waarom Dit Nodig Is

Veel SEO-trajecten falen niet door te weinig content, maar door content die los zweeft, nergens logisch naartoe linkt of niet meetbaar maakt wat bezoekers daarna doen. Deze poort dwingt daarom af dat elke nieuwe publicatie onderdeel wordt van een groter systeem.

Visuele placeholders zijn daarbij niet goed genoeg. Een publicatie moet eruitzien als een echte pagina: passende afbeelding, rustige crop, alt-tekst en een bestandsnaam die later ook in audits begrijpelijk blijft.

## Publicatieritme

De standaard blijft gecontroleerd groeien:

- 3 tot 5 sterke publicaties per week.
- Eerst money pages en ondersteunende contentclusters.
- Pas opschalen wanneer de linkstructuur, kwaliteit en meetbaarheid groen blijven.

## Werkwijze Voor Agents

- Werk vanaf een schone `codex/*` branch.
- Raak homepage-content niet aan zonder expliciete toestemming.
- Voeg geen willekeurige pagina's of tools toe zonder duidelijke SEO-reden.
- Gebruik bestaande templates en secties.
- Draai minimaal `npm run verify:critical` voor afronding.
- Als een nieuwe publicatie of pagina de poort breekt, los de oorzaak op in dezelfde PR.
