# DRE Race Incident Bot *Production*

Deze Discord‑bot ondersteunt het volledige race‑incident proces: melden, stemmen door stewards, bewijs uploaden en afhandeling.

## Wat doet de bot?
- Plaatst een meldknop in het meld‑kanaal.
- Laat rijders een incident indienen via een begeleide flow (divisie → reden → schuldige → race/ronde/bocht → beschrijving).
- Plaatst de melding als forum‑post in het stewards forumkanaal en maakt per incident een thread met stemknoppen.
- Vraagt de melder om bewijs te uploaden (DM of kanaal).
- Stuurt een DM naar de schuldige rijder om tijdens de behandeling éénmalig te reageren (binnen 2 dagen).
- Laat stewards stemmen en het eindoordeel publiceren.
- Publiceert afgehandelde incidenten in het resolved kanaal.
- Logt incidenten optioneel extern in Google Sheets.

## Hoofdflow (kort)
1) `raceincident melden` plaatst de meldknop in het meld‑kanaal.
2) Melder kiest divisie + reden + schuldige, vult race/ronde/bocht/beschrijving in en bevestigt.
3) Incident verschijnt als forum‑post in het stewards forumkanaal met een eigen thread + stemknoppen.
4) Bewijs (uploads/links) wordt aan de incident‑thread toegevoegd.
5) Schuldige ontvangt DM en kan tijdens de behandeling één keer reageren (max 2 dagen).
6) Steward sluit af met eindoordeel; bot plaatst dit in het resolved kanaal.

## Configuratie
De meeste instellingen staan in `config.json`:
- `reportChannelId` – kanaal waar de meldknop staat
- `voteChannelId` – stewards forumkanaal met incident‑threads en stemmen
- `stewardFinalizeChannelId` – kanaal-ID waar `/raceincident afhandelen` is toegestaan (valt terug op `voteChannelId`)
- `resolvedChannelId` – kanaal voor afgehandelde incidenten
- `incidentChatChannelId` – kanaal waar @bot berichten terechtkomen
- `stewardRoleId` – rol-ID voor stewards
- `allowedGuildId` – server-ID waar de bot is toegestaan (laat leeg voor alle servers)
- `incidentCounter` – teller voor incidentnummers (`INC-xxxxx`)
- `autoDeleteHours` – auto‑delete van DM‑berichten/opties
- `googleSheetsEnabled` – zet Google Sheets logging aan/uit
- `googleSheetsSpreadsheetId` – spreadsheet‑ID
- `googleSheetsSheetName` – tabbladnaam (sheet)

## Environment variabelen
- `DISCORD_TOKEN` – bot token (verplicht)
- `GOOGLE_SERVICE_ACCOUNT_JSON` – service‑account JSON (string)
- `GOOGLE_SERVICE_ACCOUNT_B64` – base64 van service‑account JSON
- `GOOGLE_SERVICE_ACCOUNT_FILE` – pad naar service‑account JSON

## Belangrijke bestanden
- `index.js` – entrypoint, registreert handlers
- `src/handlers/interaction.js` – incident workflow + stewards + DM aan schuldige
- `src/handlers/message.js` – bewijs uploads en DM‑reacties
- `src/constants.js` – tijdslimieten en incident‑redenen
- `src/config.js` – config en incidentnummer‑generator

## Tijdslimieten (in `src/constants.js`)
- `evidenceWindowMs`
- `incidentReportWindowMs`
- `finalizeWindowMs`
- `guiltyReplyWindowMs`

## Cheatsheets
- Variabelen: `VARIABELEN_CHEATSHEET.md`
- Git: `GIT_CHEATSHEET.md`
- Uitleg bot: `UITLEG_BOT.md`
- Google Sheets: `GOOGLE_SHEETS_CHEATSHEET.md`
- Discord integratie: `DISCORD_CHEATSHEET.md`

## Install / Run (kort)
1) Installeer dependencies:
   - `npm install`
2) Zet je bot token:
   - maak een `.env` met `DISCORD_TOKEN=...`
3) Start de bot:
   - `node index.js`
