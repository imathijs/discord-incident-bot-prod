# Backlog

Legenda:
- Prioriteit: P1 (hoog), P2 (middel), P3 (laag)
- Schatting: S (≤ 2u), M (0.5–1d), L (1–3d)

## Sprint planning (voorstel)

### Sprint 1 (2 weken)
- Scope:
  - Story 1 — Herstel incident uit stem-bericht
  - Story 2 — Herstel stemmen uit embed
  - Story 3 — Sheet row opslaan in embed
- Doel:
  - Afhandelen werkt weer na restart zonder handmatige interventie.
Afgerond (recent): Stemmen blokkeren voor betrokken stewards (indiener/tegenpartij) + opmerking in incident (ook retroactief bij open threads na herstart).

### Sprint 2 (2 weken)
- Scope:
  - Story 4 — Scanlimiet configureerbaar
  - Story 5 — Optionele persistent storage
  - Story 6 — Duidelijke logging bij herstel‑falen
- Doel:
  - Herstelproces is robuuster en beheersbaar.

### Sprint 3 (2 weken)
- Scope:
  - Story 7 — Handmatig rehydrate commando
  - Story 8 — Handmatige koppeling in-memory
- Doel:
  - Admin tooling voor edge‑cases en snelle fixes.

## Epic: Incident-afhandeling herstel (na restart)

### Story 1 — Herstel incident uit stem-bericht
- Prioriteit: P1
- Schatting: M
- User story: Als steward wil ik een incident kunnen afhandelen na een bot-restart, zodat tickets niet vastlopen.
- Acceptance criteria:
  - Wanneer `/raceincident afhandelen` wordt gebruikt en `activeIncidents` leeg is, zoekt de bot het stem‑bericht in het vote‑kanaal.
  - Bij match wordt het incident gereconstrueerd en daarna normaal afgehandeld.
  - Als het bericht niet gevonden wordt, krijgt de steward een duidelijke foutmelding.

### Story 2 — Herstel stemmen uit embed
- Prioriteit: P1
- Schatting: M
- User story: Als steward wil ik dat de bot eerdere stemmen meeneemt na herstel, zodat het eindoordeel klopt.
- Acceptance criteria:
  - Stemmen in het embedveld `🗳️ Stemmen - …` worden omgezet naar vote‑data.
  - Zowel dader‑ als indiener‑stemmen worden verwerkt.
  - Indien embed geen stemmen bevat, blijft de stand leeg zonder fouten.

### Story 3 — Sheet row opslaan in embed
- Prioriteit: P1
- Schatting: S
- User story: Als beheerder wil ik dat de Sheets‑rij aan het incident te koppelen is, zodat updates na herstel kunnen.
- Acceptance criteria:
  - Na het aanmaken van een incident wordt `SheetRow:<nr>` opgeslagen in de embed footer.
  - Bij herstel wordt dit nummer uit de footer gelezen en gebruikt voor Sheets‑updates.

## Epic: Robuustheid & configuratie

### Story 4 — Scanlimiet configureerbaar
- Prioriteit: P2
- Schatting: S
- User story: Als beheerder wil ik de scanlimiet instellen, zodat herstel werkt bij drukke kanalen.
- Acceptance criteria:
  - Nieuwe config key in `config.json` (bijv. `incidentRecoverScanLimit`).
  - Default blijft 300 bij afwezigheid.
  - De herstel‑scan gebruikt deze waarde.

### Story 5 — Optionele persistent storage
- Prioriteit: P2
- Schatting: L
- User story: Als beheerder wil ik incidenten persistent opslaan, zodat herstel altijd werkt na restarts.
- Acceptance criteria:
  - Open incidenten worden periodiek of event‑driven opgeslagen naar een JSON file.
  - Bij startup wordt de file ingelezen en `activeIncidents` gevuld.
  - File is optioneel en uitschakelbaar via config.

### Story 6 — Duidelijke logging bij herstel‑falen
- Prioriteit: P3
- Schatting: S
- User story: Als beheerder wil ik duidelijke logs wanneer herstel faalt, zodat ik gericht kan debuggen.
- Acceptance criteria:
  - Log vermeldt ticketnummer, kanaal en reden van falen.
  - Logging veroorzaakt geen crashes of dubbele replies.
  - Logt ook wanneer resolved thread/kanaal niet toegankelijk is.

## Epic: Functionele uitbreidingen

### Story 7 — Handmatig rehydrate commando
- Prioriteit: P3
- Schatting: M
- User story: Als admin wil ik een incident kunnen rehydraten op message‑id, zodat ik sneller kan corrigeren.
- Acceptance criteria:
  - Nieuw admin‑commando accepteert message‑id.
  - Bot haalt het stem‑bericht op en vult `activeIncidents`.
  - Succes/fout duidelijk teruggekoppeld.

### Story 8 — Handmatige koppeling in-memory
- Prioriteit: P3
- Schatting: M
- User story: Als admin wil ik een incident handmatig aan `activeIncidents` koppelen, zodat ik edge‑cases kan oplossen.
- Acceptance criteria:
  - Admin‑commando accepteert incidentnummer + message‑id.
  - Bot valideert dat het bericht een incident‑embed bevat.
  - Succes/fout duidelijk teruggekoppeld.
