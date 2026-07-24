# Mailbox media provenance

## Invariant

De mailbox toont een afbeelding alleen bij het exacte bericht waarvan de gelezen
MIME-bron een echte inline-image of image-attachment bevat. Een designlink,
`[image: ...]`-tekst, klant-, domein- of bestandsnaammatch en databasefoto zijn
nooit zelfstandig bewijs dat een afbeelding met dat bericht is verzonden.

Voor oude indexrecords zonder opgeslagen MIME-bewijs wordt uitsluitend het
exacte IMAP-bericht opnieuw gelezen. Totdat dat lukt, toont de UI geen
campagnebeeld.

## Oorzaak van de historische fout

De oude mailboxweergave gebruikte `loadStoredImagesForRecords` en
`restoreIndexedWebdesignImagesForMessages` in `server/services/mailbox.js`.
Wanneer een mailtekst op webdesign-outreach leek, zochten die functies buiten de
mail om in opgeslagen klant- en designfoto's. Zonder exacte ontvanger konden ze
via `directPhotoMetaMatchesMail` al matchen op één niet-generiek aliasdeel.

Bij een bestandsnaam als `www.softora.nl-preview` was `softora` daardoor genoeg
om te matchen met de Softora-designlink in de mailtekst. Vervolgens werd de
databasefoto als `bodyImages` aan het bericht toegevoegd en plaatste
`premium-mailbox-images.js` die op basis van campagnetekst of placeholders bij
een verzonden threadbericht. Zo kon de UI een Softora-preview tonen terwijl het
originele Gmail-bericht nul attachments en nul inline-images bevatte.

## Preventie

- De lees- en campagnereply-paden laden geen designfoto's meer uit UI-state,
  klantdata of signed URLs.
- `bodyImages` ontstaat alleen uit de MIME-parser van het exacte bericht.
- De index bewaart `embeddedImageCount` en `originalCampaignOutbound` als
  provenance; ontbrekend oud bewijs dwingt een gerichte IMAP-read af.
- De frontend toont campagnebeelden alleen als het exacte verzonden
  berichtrecord `originalCampaignOutbound: true` heeft en zelf beelden bevat.
- Inkomende quotes en vervolgberichten mogen geen campagnebeelden erven,
  verplaatsen of synthetiseren.
