# Softora Outbound Engine Blueprint

## Doel
We bouwen naast het bestaande Softora/STRATO-coldmailsysteem een losse outbound-machine voor toekomstige schaal. Het huidige systeem blijft de veilige live-lane op beperkt volume en wordt niet gebruikt als testgebied voor hogere volumes.

Het doel van de nieuwe engine is gecontroleerd kunnen opschalen richting ongeveer 500 outbound e-mails per werkdag, met lage volumes per inbox, sterke monitoring, goede data, duidelijke opt-out en automatische pauzes bij risico.

## Harde grenzen
- `softora.nl` blijft beschermd en draait niet mee in schaalexperimenten.
- Geen brute-force verzending vanuit 1 of enkele mailboxen.
- Geen misleidende domeinen, naamvarianten of verborgen afzenders.
- Geen providerlimieten proberen te omzeilen.
- Geen scraping of platformautomatisering die tegen voorwaarden ingaat.
- Geen verzending zonder centrale suppressielijst voor uitschrijvingen, bounces en "niet meer mailen".
- Geen productie-activatie zonder ramp-up, monitoring en noodstop.

## Systeemopzet
De outbound-machine bestaat uit drie lagen:

1. Safe Lane
- Bestaande Softora coldmailing.
- Beperkt volume.
- Alleen huidige bekende mailboxen.
- Blijft los van de nieuwe outbound-engine.

2. Outbound Engine
- Aparte outbound-domeinen.
- Meerdere inboxen per domein.
- Lage dagquota per inbox.
- Eigen scheduler, wachtrij, dashboards en health checks.
- Centrale opt-out, bounce en reply-verwerking.

3. Warm Lead Engine
- Opt-in, retargeting, nieuwsbrief of bestaande relatie.
- Geschikt voor hogere volumes via marketingtools.
- Los van koude outbound, omdat de spelregels anders zijn.

## Volume-strategie
De veilige schaal komt niet uit harder sturen per mailbox, maar uit meer gezonde inboxen met lage druk.

Richtlijn:
- 20 tot 25 inboxen.
- 20 tot 25 koude mails per inbox per werkdag.
- Alleen binnen veilige verzenduren.
- Menselijke spreiding over de dag.
- Automatische verlaging bij negatieve signalen.

Een campagne met follow-ups telt mee in dagvolume. Bij 500 verzonden mails per dag zijn er dus niet automatisch 500 nieuwe leads per dag; follow-ups nemen ook volume in.

## Ramp-up
Voor iedere nieuwe inbox:

- Week 1-2: technische setup, domeincontrole, inboxcontrole, kleine testflows.
- Week 3: maximaal 5 mails per dag.
- Week 4: maximaal 10 mails per dag.
- Week 5: maximaal 15 mails per dag.
- Week 6-8: maximaal 20 mails per dag.
- Daarna alleen verhogen als alle health scores groen blijven.

## Monitoring
Iedere dag moet de engine minimaal deze signalen meten:

- Bounce rate.
- SMTP-errors en rate limits.
- SPF, DKIM en DMARC-status.
- Spam placement via seed inboxes.
- Reputatie per domein en inbox.
- Replies, positieve replies en negatieve replies.
- Uitschrijvingen en "niet meer mailen".
- Afzender-match: de mail moet altijd namens de geplande inbox gaan.
- Content-match: onderwerp, tekst, landingspagina en assets moeten bij de campagne horen.

## Stopregels
De engine pauzeert automatisch bij:

- Bounce rate boven 2 procent.
- Spamklachten rond of boven 0,1 procent.
- DMARC, DKIM of SPF-fouten.
- Providerwaarschuwingen of rate-limit-errors.
- Seed inboxes die structureel in spam landen.
- Afzenders die niet overeenkomen met de geplande sender.
- Content die niet overeenkomt met de goedgekeurde campagne.
- Te veel negatieve replies of opt-outs.

Bij een harde fout gaat alleen de betrokken inbox, domein of campagne dicht. De huidige Softora Safe Lane blijft los staan.

## Data-eisen
Leads mogen pas de wachtrij in als ze voldoen aan:

- Bedrijfsnaam aanwezig.
- Website of betrouwbare bron aanwezig.
- Reden van relevantie bekend.
- Geen eerder opt-out of bounce.
- Geen dubbele lead binnen actieve campagnes.
- Geen generieke rommeldata zonder duidelijke match met het aanbod.

## MVP
De eerste versie bouwt nog geen 500 mails per dag. De eerste versie bewijst controle.

MVP-onderdelen:
- Outbound domein- en inboxregister.
- Campaign builder zonder koppeling met bestaande STRATO-flow.
- Queue met dagquota per inbox.
- Sender/content validation voordat iets verzonden wordt.
- Central suppression list.
- Bounce/reply/opt-out verwerking.
- Health dashboard.
- Emergency pause per inbox, domein, campagne en totaal systeem.
- Dry-run modus die exact laat zien wat verzonden zou worden.

## Eerste bouwvolgorde
1. Datamodel en veiligheidsregels vastleggen.
2. Dashboard ontwerpen voor inboxen, domeinen, campagnes en health.
3. Dry-run scheduler bouwen zonder echte verzending.
4. Sender/content guard toevoegen.
5. Suppression list en opt-out-flow bouwen.
6. Bounce en reply-verwerking aansluiten.
7. Kleine gesloten pilot met een paar inboxen.
8. Ramp-up pas starten als monitoring betrouwbaar is.

## Succescriterium
Dit project is pas klaar voor schaal als we per dag kunnen zien:

- Hoeveel er gepland stond.
- Hoeveel er echt verzonden is.
- Via welke inboxen.
- Welke campagne en content gebruikt is.
- Hoeveel bounces, replies, opt-outs en negatieve signalen er waren.
- Of iedere inbox nog groen, oranje of rood staat.
- Waarom het systeem eventueel automatisch heeft gepauzeerd.

## Belangrijkste principe
Volume is het spel, maar reputatie is de zuurstof. We bouwen dit daarom als sales-engine met remmen, meters en noodstop, niet als mailkanon.
