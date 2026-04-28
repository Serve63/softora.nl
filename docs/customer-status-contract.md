# Customer status contract

Dit document is het agent-vriendelijke contract voor klantstatussen in de premium klantenrepository.

## Doel

Klantstatussen worden door meerdere domeinen gebruikt: agenda, leads, coldcalling, coldmailing en dashboardcontext. Daarom mag statuslogica niet verspreid raken over losse flows.

Gebruik centrale repository-helpers voor statusupdates en statusgeschiedenis. Voeg geen nieuwe ad-hoc statusnormalisatie toe in routes, coordinators of frontend scripts.

## Veilige route

Gebruik `updateCustomerStatusWithHistoryInRows` wanneer een bestaande klant op identiteit een nieuwe status moet krijgen.

Deze helper hoort de veilige standaard te zijn omdat hij:

- klantstatussen centraal normaliseert;
- statusgeschiedenis via het centrale history-contract toevoegt;
- bronrijen niet muteert;
- lege of verkeerd gevormde invoer veilig als no-op behandelt;
- lege statuswaarden weigert zonder klantdata te wijzigen;
- dezelfde result-shape teruggeeft voor update, miss en invalid input.

## Verwacht result-contract

De helper geeft altijd een object terug met:

```js
{
  rows,
  updated,
  status,
  index,
  customer,
}
```

Gebruik `updated === true` als enige signaal dat er echt klantdata gewijzigd is.

## Identiteit

Match klanten op bestaande repository-identiteit. Telefoon is op dit moment de meest betrouwbare identiteit voor statusupdates in gemigreerde flows.

Gebruik geen losse stringvergelijkingen in nieuwe businesslogica. Als een flow extra identiteit nodig heeft, breid dan eerst de repository-contracten uit met tests.

## Niet doen

Schrijf geen nieuwe statusgeschiedenis met losse `hist.push(...)` logica buiten de repository.

Schrijf geen directe statusaliases in routes of grote serviceflows.

Breid `server.js` niet uit met klantstatuslogica.

Voeg geen parallel opslagpad toe voor klantstatussen zonder compat-flag, rollback-pad en contracttest.

## Testverwachting

Nieuwe of aangepaste statusflows horen minimaal een contracttest te hebben voor:

- de succesvolle update;
- een missende klantmatch;
- invalid of lege statusinput;
- brondata die niet gemuteerd mag worden;
- statusgeschiedenis die begrensd blijft.

## Update-resultaat interpreteren

Behandel alleen `updated === true` als een echte klantstatuswijziging.

Alle andere resultaten zijn geen succesvolle statusmutatie, ook als `rows` of `status` gevuld zijn. Dat geldt voor missende klantmatches, lege input, verkeerd gevormde input en geweigerde statuswaarden.

Nieuwe flows mogen daarom niet op `rows.length`, `status`, `index >= 0` of een gevuld `customer`-object vertrouwen als succescriterium. Gebruik altijd `updated === true` voordat je vervolgacties zoals persist, dashboardactiviteit of vervolgstatussen uitvoert.
