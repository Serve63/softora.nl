# PaperTrader V17 research protocol

## Doel

V17 maakt van de losse V16-browserlab een reproduceerbare researchkern. Deze fase plaatst geen echte orders,
gebruikt geen API-secrets en activeert geen betaalde dienst.

## Bevroren V16-bron

- Lokale bron tijdens migratie: `paper_trader_core_hold_tactical_shield_v16.html`
- Aanmaakdatum bron: 2026-05-04 12:50:30 +0200
- Grootte: 65.765 bytes
- SHA-256: `c37d01777991740ab0464b8bd88a599949f49cb9f8ab267671b30362b2814002`

De lokale Downloads-map is geen productiebron. Deze hash legt uitsluitend vast welke V16-versie als inhoudelijke
referentie voor V17 is gebruikt.

## Execution contract

1. Een strategie ziet alleen candles tot en met de huidige volledig gesloten candle.
2. Een beslissing op candle `t` wordt nooit op candle `t` uitgevoerd.
3. Uitvoering gebeurt op de open van candle `t+1`, met nadelige slippage en expliciete fees.
4. Het laatste signaal in een dataset blijft pending en telt niet als uitgevoerde order.
5. Elke run rapporteert een SHA-256-fingerprint van de genormaliseerde dataset.
6. Ongeldige gewichten, onbekende symbolen en allocaties boven 100% stoppen de run.

## Datasetformaat

De CLI verwacht JSON met een `candlesBySymbol` object, of direct dat object:

```json
{
  "candlesBySymbol": {
    "BTCUSDT": [
      { "time": 1710000000000, "open": 62000, "high": 63000, "low": 61000, "close": 62500, "volume": 1000 }
    ]
  }
}
```

Start een reproduceerbare run met:

```bash
npm run papertrader:v17 -- --dataset /absoluut/pad/candles.json
```

## Nog geblokkeerd voor vervolgfases

- Geen exchange-account of live orderrechten.
- Geen browseropslag als formeel trackrecord.
- Geen claim van winstgevendheid op basis van deze eerste researchmotor.
- Geen live activatie zonder afzonderlijke forwardtest, exchange-reconciliatie en expliciete bedragstoestemming.
