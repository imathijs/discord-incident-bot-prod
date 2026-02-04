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

## How‑to (leden): incident terugnemen
Gebruik dit alleen zolang het incident nog **niet** is afgehandeld.
1) Voer het commando uit: `/raceincident neemterug ticketnummer:<INC-xxxxx>`.
2) Alleen de indiener kan dit doen.
3) Het incident wordt verwijderd uit de stem‑thread.
4) In de incident‑thread verschijnt: “Incident is teruggetrokken door <naam indiener>”.
5) Als het incident al is afgehandeld krijg je de melding dat terugnemen niet meer kan.

## Stewards (beheer)
### Incident terugnemen: wat gebeurt er?
- Alleen de oorspronkelijke indiener mag een incident terugnemen.
- Als het incident al is afgehandeld, wordt terugnemen geweigerd en verschijnt er een melding in de thread.
- Als het incident nog open staat, wordt het stem‑bericht verwijderd (of op status “Teruggenomen” gezet als verwijderen niet kan).
- Als het incident nog open staat, krijgt de thread een bericht dat het incident is teruggetrokken.
- Als het incident nog open staat, verdwijnt het incident uit de actieve incidentenlijst.
- Als het incident nog open staat, verschijnt in het resolved kanaal een korte melding + embed met samenvatting.

## Configuratie
De meeste instellingen staan in `config.json`:
- `reportChannelId` – kanaal waar de meldknop staat
- `voteChannelId` – stewards forumkanaal met incident‑threads en stemmen
- `stewardFinalizeChannelId` – kanaal-ID waar `/raceincident afhandelen` is toegestaan, inclusief alle threads daaronder (valt terug op `voteChannelId`)
- `resolvedChannelId` – kanaal voor afgehandelde incidenten
- `withdrawNoticeChannelId` – kanaal/thread voor melding bij terugnemen (leeg = niet posten)
- `incidentChatChannelId` – kanaal waar @bot berichten terechtkomen
- `stewardRoleId` – rol-ID voor stewards
- `allowedGuildId` – server-ID waar de bot is toegestaan (laat leeg voor alle servers)
- `incidentCounter` – teller voor incidentnummers (`INC-xxxxx`)
- `autoDeleteHours` – auto‑delete van DM‑berichten/opties
- `googleSheetsEnabled` – zet Google Sheets logging aan/uit
- `googleSheetsSpreadsheetId` – spreadsheet‑ID
- `googleSheetsSheetName` – tabbladnaam (sheet)

## Discord‑rechten (bot)
Minimale rechten bij het uitnodigen van de bot (OAuth2):
- View Channels
- Send Messages
- Send Messages in Threads
- Create Public Threads
- Read Message History
- Embed Links
- Attach Files
- Use Slash Commands
- Manage Threads (aanbevolen om archived threads te openen)

Verder nodig:
- **Message Content Intent** aanzetten in de Discord Developer Portal (nodig voor DM‑berichten).

Details en setup: `DISCORD_CHEATSHEET.md`.

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
