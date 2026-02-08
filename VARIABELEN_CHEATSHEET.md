# Variabelen cheat sheet (DRE Incident Bot)

Deze korte cheat sheet helpt je snel de belangrijkste variabelen te vinden en aan te passen.

## 1) Configuratiebestand
Bestand: `config.json`

Belangrijkste velden (gebruik je eigen IDs):
- `reportChannelId` – kanaal waar de meldknop staat (incident melden)
- `voteChannelId` – stewards kanaal waar incidenten en stemmen verschijnen
- `resolvedChannelId` – kanaal waar afgehandelde incidenten worden geplaatst
- `resolvedThreadId` – thread‑ID waar het besluit te vinden is (wordt in DM gedeeld)
- `incidentChatChannelId` – kanaal waar @bot berichten worden doorgestuurd
- `stewardRoleId` – rol-ID van stewards (toegang / mentions)
- `incidentStewardRoleId` – rol-ID voor @Incident steward (bij terugnemen)
- `allowedGuildId` – server-ID waar de bot mag werken (laat leeg voor alle servers)
- `incidentCounter` – teller voor incidentnummers (`INC-xxxxx`)
- `autoDeleteHours` – aantal uur voordat DM‑uploads / bot‑berichten worden verwijderd
- `googleSheetsEnabled` – zet Google Sheets logging aan/uit
- `googleSheetsSpreadsheetId` – spreadsheet‑ID
- `googleSheetsSheetName` – tabbladnaam (sheet)

Let op: stemregels zijn automatisch. Als een steward betrokken is als **indiener** of **tegenpartij**, kan die persoon niet stemmen en verschijnt er een **⚠️ Opmerking** in het incident.

Voorbeeld:
```json
{
  "reportChannelId": "1234567890",
  "voteChannelId": "1234567890",
  "resolvedChannelId": "1234567890",
  "incidentChatChannelId": "1234567890",
  "stewardRoleId": "1234567890",
  "incidentStewardRoleId": "1234567890",
  "allowedGuildId": "",
  "incidentCounter": 2026000,
  "autoDeleteHours": 24,
  "googleSheetsEnabled": false,
  "googleSheetsSpreadsheetId": "",
  "googleSheetsSheetName": "Incidenten"
}
```

## 2) Environment variabelen
Bestand: `.env` (of via hosting provider)

- `DISCORD_TOKEN` – **verplicht**. De bot token.
- `GOOGLE_SERVICE_ACCOUNT_JSON` – service‑account JSON (string)
- `GOOGLE_SERVICE_ACCOUNT_B64` – base64 van service‑account JSON
- `GOOGLE_SERVICE_ACCOUNT_FILE` – pad naar service‑account JSON

Voorbeeld:
```
DISCORD_TOKEN=your_bot_token_here
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

## 3) Tijdslimieten (in code)
Bestand: `src/constants.js`

Hier pas je tijden (ms) aan:
- `evidenceWindowMs` – tijd om bewijs te uploaden
- `incidentReportWindowMs` – tijd om incident te voltooien
- `finalizeWindowMs` – tijd om eindoordeel te vullen
- `guiltyReplyWindowMs` – **2 dagen** voor reactie van de schuldige

Voorbeeld (5 min):
```js
const evidenceWindowMs = 5 * 60 * 1000;
```

## 4) Lijst met incident‑redenen
Bestand: `src/constants.js`

Hier kun je redenen toevoegen/verwijderen:
```js
const incidentReasons = [
  { label: 'Blauwe vlaggen negeren', value: 'blauwe_vlaggen' },
  { label: 'Anders', value: 'anders' }
];
```

## 5) Teksten / DM‑berichten
Bestanden:
- `src/infrastructure/discord/interaction.js` (incident workflow + DM naar schuldige)
- `src/infrastructure/discord/message.js` (reacties via DM + bevestigingen)

Zoek op sleutelzinnen zoals:
- `Je incident is verzonden naar de stewards`
- `Er is een race incident ingediend door`
- `Je reactie is doorgestuurd naar de stewards`

## 6) Incidentnummer formaat
Bestand: `src/config.js`

```js
function generateIncidentNumber() {
  const current = Number(config.incidentCounter) || 2026000;
  const next = current + 1;
  config.incidentCounter = next;
  saveConfig();
  return `INC-${next}`;
}
```

## 7) Wat moet je herstarten?
Na aanpassingen in code of config:
- Bot herstarten (bijv. `node index.js` of je process manager)

## Snelle checklist
- Pas kanaal‑IDs aan in `config.json`
- Zet `DISCORD_TOKEN` in `.env`
- Stel tijden in via `src/constants.js`
- Pas teksten aan in `src/infrastructure/discord/interaction.js` / `src/infrastructure/discord/message.js`
