# Robot v8: geïsoleerde proef

De eerste meetcijfers en hun grenzen staan in [BENCHMARK.md](BENCHMARK.md).

Deze kandidaat verandert alleen de zwakke `cross_source_profile`-koppeling van
de geïnstalleerde v7-engine. Een gedeelde achternaam met dezelfde contactgegevens
ergens op twee websites bewijst niet dat beide websites het doelbedrijf bedoelen.
Dat kon verkeerde concurrerende kandidaten opleveren en een juiste eigen site
blokkeren.

De proef eist per ondersteunende pagina een lokale binding: exact gelabeld
doel-KVK plus juridische naam, of juridische naam plus de toegewezen straat en
plaats. Hetzelfde e-mail/telefoonpaar moet in die doelregio liggen op minstens
twee verschillende domeinroots. Subdomeinen en de eigen root tellen niet als
extra bron. Verschillende roots bewijzen op zichzelf geen onafhankelijke
uitgevers. Bestaande overige identiteitspoorten blijven actief.

## Uitvoering

De scripts installeren niets in de worker. De live enginekeuze bevat nog
uitsluitend v5/v7. `--candidate` zet de overlay alleen in het replayproces aan.
Gebruik de Python-omgeving van de lokale Database-installatie, met Python 3.12.
Die installatie bevat de oorspronkelijke v7-engine en capture-/parseermodules.

```sh
export SOFTORA_ROBOT_SHADOW_ROOT="$HOME/Documents/Database"
"$SOFTORA_ROBOT_SHADOW_ROOT/.venv-robot-zero/bin/python" \
  -m unittest discover -s scripts/kvk_robot_v8_shadow -p 'test_*.py'

"$SOFTORA_ROBOT_SHADOW_ROOT/.venv-robot-zero/bin/python" \
  scripts/kvk_robot_v8_shadow/replay.py \
  "$SOFTORA_ROBOT_SHADOW_ROOT/data/shadow/BRON" \
  "$SOFTORA_ROBOT_SHADOW_ROOT/data/shadow/UITVOER/baseline.json"

"$SOFTORA_ROBOT_SHADOW_ROOT/.venv-robot-zero/bin/python" \
  scripts/kvk_robot_v8_shadow/replay.py \
  "$SOFTORA_ROBOT_SHADOW_ROOT/data/shadow/BRON" \
  "$SOFTORA_ROBOT_SHADOW_ROOT/data/shadow/UITVOER/candidate.json" --candidate

python3 scripts/kvk_robot_v8_shadow/compare.py \
  "$SOFTORA_ROBOT_SHADOW_ROOT/data/shadow/REFERENTIE/truth.json" \
  "$SOFTORA_ROBOT_SHADOW_ROOT/data/shadow/UITVOER/baseline.json" \
  "$SOFTORA_ROBOT_SHADOW_ROOT/data/shadow/UITVOER/candidate.json"
```

Gebruik nieuwe uitvoernamen; bestaande resultaten worden nooit overschreven.
Bron en uitvoer moeten in `data/shadow` liggen; uitvoer mag niet onder de bron
staan. SQLite en eventuele WAL/SHM-bestanden worden naar een tijdelijke map
gekopieerd, daarna is de verbinding alleen-lezen. Capture- en geïmporteerde
broncodehashes worden voor/na gecontroleerd en in de lokale audit bewaard.

Alle drie AI-flags worden vóór import uitgezet. De audit-hook blokkeert sockets,
DNS, `os.system` en willekeurige subprocessen. Alleen de bestaande lokale,
begrensde PDF-worker mag als exact Python-commando draaien. Deze controle is een
extra verdedigingslaag voor bekende lokale modules; zij is geen OS-sandbox voor
willekeurige kwaadaardige code. Er is geen apply- of productie-installatiestap.

## Bewijs en vervolgstap

De vergelijking gebruikt bestaande historische referenties en exact dezelfde
opgeslagen webpagina's per variant. Die sets zijn eerder bekeken/gebruikt voor
ontwikkeling; dit is geen verse onafhankelijke holdout. Exacte contactovereenkomst
meet overeenkomst met de historische referentie, niet automatisch de actuele
juistheid van alle alternatieve contactgegevens. Nul foutieve goedkeuringen op
negatieve voorbeelden bewijst evenmin dat alle goedgekeurde contactsets kloppen.

De lokale contactuitvoer, SQLite-captures en individuele foutanalyses blijven
buiten Git. Alleen de proefcode, synthetische tests en geaggregeerde meetcijfers
worden vastgelegd. Voor live gebruik zijn een verse onafhankelijk beoordeelde
gold set, de bestaande kwaliteitspoorten en aparte activatietoestemming nodig.
