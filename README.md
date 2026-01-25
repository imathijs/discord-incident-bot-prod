# DRE Race Incident Bot

Deze Discord‑bot ondersteunt het volledige race‑incident proces: melden, stemmen door stewards, bewijs uploaden, wederwoord en afhandeling.

## Wat doet de bot?
- Plaatst een meldknop in het meld‑kanaal.
- Laat rijders een incident indienen via een begeleide flow (reden → schuldige → race/ronde → beschrijving).
- Stuurt de melding door naar het stewards kanaal met stemknoppen.
- Vraagt de melder om bewijs te uploaden (DM of kanaal).
- Stuurt een DM naar de schuldige rijder om te reageren (éénmalig, binnen 2 dagen).
- Laat stewards stemmen en het eindoordeel publiceren.
- Publiceert afgehandelde incidenten in het resolved kanaal.

## Hoofdflow (kort)
1) `raceincident melden` plaatst de meldknop in het meld‑kanaal.
2) Melder kiest reden + schuldige, vult race/ronde/beschrijving in en bevestigt.
3) Incident verschijnt in het stewards kanaal met stemknoppen.
4) Melder uploadt bewijs via DM (of kanaal).
5) Schuldige ontvangt DM en kan één keer reageren (max 2 dagen).
6) Steward sluit af met eindoordeel; bot plaatst dit in het resolved kanaal.

## Configuratie
De meeste instellingen staan in `config.json`:
- `reportChannelId` – kanaal waar de meldknop staat
- `voteChannelId` – stewards kanaal met incidenten en stemmen
- `resolvedChannelId` – kanaal voor afgehandelde incidenten
- `incidentChatChannelId` – kanaal waar @bot berichten terechtkomen
- `stewardRoleId` – rol-ID voor stewards
- `incidentCounter` – teller voor incidentnummers (`INC-xxxxx`)
- `autoDeleteHours` – auto‑delete van DM‑berichten/opties

## Environment variabelen
- `DISCORD_TOKEN` – bot token (verplicht)

## Belangrijke bestanden
- `index.js` – entrypoint, registreert handlers
- `src/handlers/interaction.js` – incident workflow + stewards + DM aan schuldige
- `src/handlers/message.js` – bewijs uploads en DM‑reacties
- `src/constants.js` – tijdslimieten en incident‑redenen
- `src/config.js` – config en incidentnummer‑generator

## Tijdslimieten (in `src/constants.js`)
- `evidenceWindowMs`
- `incidentReportWindowMs`
- `appealWindowMs`
- `finalizeWindowMs`
- `guiltyReplyWindowMs`

## Cheatsheets
- Variabelen: `VARIABELEN_CHEATSHEET.md`
- Git: `GIT_CHEATSHEET.md`

## Install / Run (kort)
1) Installeer dependencies:
   - `npm install`
2) Zet je bot token:
   - maak een `.env` met `DISCORD_TOKEN=...`
3) Start de bot:
   - `node index.js`
