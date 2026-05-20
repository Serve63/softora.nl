# Softora SEO Machine Quality Gates

Deze poorten bewaken dat de SEO-machine niet alleen publiceert, maar ook netjes blijft bouwen.

## Wat De Poort Bewaakt

- Contentkwaliteit: iedere live publicatie heeft een duidelijke titel, meta description, minimaal drie inhoudsblokken, echte verdieping, FAQ, auteur/review-signaal, een bekend cluster en interne links naar money pages.
- Woorddiepte: blogs en vergelijkingen mogen niet meer als korte 200-woorden stukken live komen. De poort bewaakt nu minimaal 900 woorden voor blogs, 850 voor vergelijkingen, 650 voor kennisbank en 700 voor branche/regio. Voor zware koopintentie-artikelen blijft het richtpunt 1200-1800 woorden wanneer de zoekvraag dat vraagt.
- E-E-A-T: content toont aan de voorkant wie de uitleg schrijft/controleert en gebruikt structured data met auteur, review, wordCount en FAQ waar passend.
- Claimveiligheid: nieuwe content mag geen onbewezen garanties, rankingbeloftes, absolute securityclaims, certificeringen, markleiderclaims, harde klant/projectaantallen of gereguleerd advies noemen zonder bron en expliciete toestemming.
- Afbeeldingen: iedere SEO-publicatie gebruikt een echte foto uit `/assets/seo-content/` met beschrijvende bestandsnaam en alt-tekst. Geen placeholders of neppe computerachtige visuals.
- Interne linkgraph: belangrijke commerciële pagina's moeten genoeg interne ingangen krijgen vanuit publieke pagina's en content.
- CTA-meetbaarheid: publieke commerciële pagina's en SEO-content krijgen meetlabels op contact- en service-CTA's, zodat we later beter kunnen zien welke pagina's leads helpen maken.
- Schone publieke structuur: content en navigatie gebruiken gewone publieke URL's zoals `/diensten`, `/pakketten`, `/website-laten-maken` en `/ai-automatisering`.
- Homepage-rust: de homepage-content blijft buiten deze poort; alleen footer/SEO-infrastructuur mag daar geraakt worden wanneer dat expliciet nodig is.

## Waarom Dit Nodig Is

Veel SEO-trajecten falen niet door te weinig content, maar door content die los zweeft, nergens logisch naartoe linkt of niet meetbaar maakt wat bezoekers daarna doen. Deze poort dwingt daarom af dat elke nieuwe publicatie onderdeel wordt van een groter systeem.

## Publicatieritme

De standaard blijft gecontroleerd groeien:

- 3 tot 5 sterke publicaties per week.
- Eerst money pages en ondersteunende contentclusters.
- Pas opschalen wanneer de linkstructuur, kwaliteit en meetbaarheid groen blijven.
- Nieuwe publicaties krijgen pas groen licht als tekst, foto, alt-tekst, interne links, CTA en E-E-A-T samen kloppen.

## Werkwijze Voor Agents

- Werk vanaf een schone `codex/*` branch.
- Raak homepage-content niet aan zonder expliciete toestemming.
- Voeg geen willekeurige pagina's of tools toe zonder duidelijke SEO-reden.
- Gebruik bestaande templates en secties.
- Schrijf alleen over Softora-diensten die echt bestaan: websites, bedrijfssoftware, CRM, AI automatisering, chatbots, AI telefonie, Oisterwijk/Tilburg/regio en MKB leadopvolging.
- Verboden zonder harde bron: "gegarandeerd nummer 1", vaste lead/omzetgaranties, "100% veilig", "hackvrij", "Google Partner", "ISO 27001", "marktleider", "grootste speler", verzonnen klantenaantallen, reviews, awards of gereguleerd medisch/juridisch/fiscaal/beleggingsadvies.
- Houd AI-claims eerlijk: AI mag ondersteunen, samenvatten, kwalificeren en opvolging voorbereiden, maar claim niet dat AI altijd correct is, alle medewerkers vervangt of zonder menselijke controle alle beslissingen neemt.
- Draai minimaal `npm run verify:critical` voor afronding.
- Als een nieuwe publicatie of pagina de poort breekt, los de oorzaak op in dezelfde PR.
