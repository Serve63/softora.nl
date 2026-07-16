# Softora SEO Machine Quality Gates

Deze poorten bewaken dat de SEO-machine niet alleen publiceert, maar ook netjes blijft bouwen.

## Wat De Poort Bewaakt

- Contentkwaliteit: iedere live publicatie heeft een duidelijke titel, meta description, minimaal drie inhoudsblokken, echte verdieping, FAQ, auteur/review-signaal, een bekend cluster en interne links naar money pages.
- Woorddiepte: blogs en vergelijkingen mogen niet meer als korte 200-woorden stukken live komen. De poort bewaakt nu minimaal 900 woorden voor blogs, 850 voor vergelijkingen, 650 voor kennisbank en 700 voor branche/regio. Voor zware koopintentie-artikelen blijft het richtpunt 1200-1800 woorden wanneer de zoekvraag dat vraagt.
- E-E-A-T: content toont aan de voorkant wie de uitleg schrijft/controleert en gebruikt structured data met auteur, review, wordCount en FAQ waar passend.
- Claimveiligheid: nieuwe content mag geen onbewezen garanties, rankingbeloftes, absolute securityclaims, certificeringen, markleiderclaims, harde klant/projectaantallen of gereguleerd advies noemen zonder bron en expliciete toestemming.
- Afbeeldingen: ieder nieuw of substantieel vernieuwd blog gebruikt exact twee eigen, nuttige Softora-visuals uit `/assets/seo-content/`, met beschrijvende bestandsnamen, betekenisvolle alt-tekst, vaste dimensies en gecontroleerd gewicht. Geen stockfoto's, placeholders, generieke kantoorbeelden of decoratieve filler.
- Interne linkgraph: belangrijke commerciële pagina's moeten genoeg interne ingangen krijgen vanuit publieke pagina's en content.
- CTA-meetbaarheid: publieke commerciële pagina's en SEO-content krijgen meetlabels op contact- en service-CTA's, zodat we later beter kunnen zien welke pagina's leads helpen maken.
- Schone publieke structuur: content en navigatie gebruiken gewone publieke URL's zoals `/diensten`, `/pakketten`, `/website-laten-maken` en `/ai-automatisering`.
- Homepage-rust: de homepage-content blijft buiten deze poort; alleen footer/SEO-infrastructuur mag daar geraakt worden wanneer dat expliciet nodig is.

## Waarom Dit Nodig Is

Veel SEO-trajecten falen niet door te weinig content, maar door content die los zweeft, nergens logisch naartoe linkt of niet meetbaar maakt wat bezoekers daarna doen. Deze poort dwingt daarom af dat elke nieuwe publicatie onderdeel wordt van een groter systeem.

## Publicatieritme

De standaard combineert tempo met harde kwaliteit:

- Een publieke SEO-groeiverbetering per succesvolle dagelijkse run en 5 tot 7 sterke contentpublicaties per week.
- Een nieuw ondersteunend blog is de standaard wanneer de beste money page binnen zijn 28-daagse cooldown valt.
- Onderhoud aan een oude PR, rapportage of URL Inspection telt niet als publicatie.
- Eerst money pages en ondersteunende contentclusters.
- De cooldown geldt per URL en mag een heel cluster nooit stilleggen.
- Nieuwe publicaties krijgen pas groen licht als tekst, visuals, alt-tekst, interne links, CTA en E-E-A-T samen kloppen.
- Blogs, kennisbank, vergelijkingen, unieke landingspagina's en bronvaste nieuwsupdates mogen allemaal bijdragen; de dagelijkse keuze volgt verwachte gekwalificeerde impact en clusterfit.
- Een no-op is alleen geldig bij een gedocumenteerde P0, claim-/expertiserisico, onoplosbare cannibalisatie of externe merge/deployblokkade.
- Backlinks en off-site linkbuilding vallen buiten de automation; alle publieke groei komt uit on-site content, techniek, indexatie, interne links, structured data, UX, CRO, visuals en aantoonbare eigen trustsignalen.

## Werkwijze Voor Agents

- Werk vanaf een schone `codex/*` branch.
- Raak homepage-content niet aan zonder expliciete toestemming.
- Voeg geen willekeurige pagina's of tools toe zonder duidelijke SEO-reden.
- Houd in de ene bestaande SEO-automation minimaal 15 gescoorde kandidaatbriefs vooruit, zodat zwakke dagelijkse GSC-data niet tot stilstand leidt.
- Gebruik uitsluitend `docs/growth/seo-machine-backlog.json` als machineleesbare backlogbron en laat `npm run seo:backlog:check` groen zijn voordat een kandidaat wordt gekozen.
- Draai `npm run seo:publications:report` voor de 7/28-daagse cohorttelling; alleen live 200-, indexeerbare, self-canonical sitemap-URL's op de actuele productiecommit tellen mee.
- Draai `npm run seo:cadence:check` als dagelijkse beslispoort. Exitcode `2` betekent dat contentpublicatie verplicht is; exitcode `1` betekent operationele P0.
- Doe geen backlink-outreach, gastblogplaatsingen, directorylinks, linkruil of betaalde links.
- Gebruik bestaande templates en secties.
- Schrijf alleen over Softora-diensten die echt bestaan: websites, bedrijfssoftware, CRM, AI automatisering, chatbots, AI telefonie, Oisterwijk/Tilburg/regio en MKB leadopvolging.
- Verboden zonder harde bron: "gegarandeerd nummer 1", vaste lead/omzetgaranties, "100% veilig", "hackvrij", "Google Partner", "ISO 27001", "marktleider", "grootste speler", verzonnen klantenaantallen, reviews, awards of gereguleerd medisch/juridisch/fiscaal/beleggingsadvies.
- Houd AI-claims eerlijk: AI mag ondersteunen, samenvatten, kwalificeren en opvolging voorbereiden, maar claim niet dat AI altijd correct is, alle medewerkers vervangt of zonder menselijke controle alle beslissingen neemt.
- Draai minimaal `npm run verify:critical` voor afronding.
- Als een nieuwe publicatie of pagina de poort breekt, los de oorzaak op in dezelfde PR.
