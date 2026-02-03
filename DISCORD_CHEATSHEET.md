# Discord cheat sheet (DRE Incident Bot)

Deze cheat sheet is gericht op de DRE‑setup met een **forum‑thread** voor meldingen, een **stewards kanaal/thread** voor stemmen, en een **resolved kanaal/thread** voor uitslagen.

## 1) Discord Developer Portal
1) Maak een Application aan.
2) Ga naar **Bot** en klik **Add Bot**.
3) Zet **Message Content Intent** aan (nodig voor DM‑berichten).
4) Kopieer de **Bot Token**.

## 2) Bot uitnodigen naar je server
Gebruik de OAuth2 invite URL met:
- Scopes: `bot`, `applications.commands`
- Permissions (minimaal):
  - View Channels
  - Send Messages
  - Send Messages in Threads
  - Create Public Threads
  - Read Message History
  - Embed Links
  - Attach Files
  - Use Slash Commands
  - Manage Threads (aanbevolen om archived threads te openen)

## 3) Aanbevolen Discord‑structuur
Maak (of gebruik) deze plekken:
- **Meldingen (forum‑thread)**: hier run je `/raceincident melden` en staat de meldknop.
- **Stewards (kanaal of thread)**: hier verschijnen incidenten + stemknoppen.
- **Resolved (kanaal of thread)**: hier plaatst de bot het eindoordeel.
- **Incident chat kanaal**: @bot‑mentions worden hierheen doorgestuurd.

Belangrijk:
- `reportChannelId` moet het **thread‑ID** zijn van de forum‑thread met de meldknop.
- `voteChannelId` mag een **kanaal** of **thread** zijn (bot moet toegang hebben).
- `resolvedThreadId` is optioneel; als die ontbreekt, gebruikt de bot `resolvedChannelId`.

## 4) IDs invullen in config.json
Bestand: `config.json`

Vul je IDs in:
- `reportChannelId` – forum‑thread voor incidentmeldingen
- `voteChannelId` – stewards kanaal of thread
- `stewardFinalizeChannelId` – kanaal-ID waar `/raceincident afhandelen` is toegestaan, inclusief alle threads daaronder (valt terug op `voteChannelId`)
- `resolvedChannelId` – kanaal voor afgehandelde incidenten
- `resolvedThreadId` – thread voor besluiten (optioneel)
- `incidentChatChannelId` – kanaal voor @bot berichten
- `stewardRoleId` – rol‑ID van stewards
- `allowedGuildId` – server‑ID waar de bot mag werken (laat leeg voor alle servers)

Tip: Zet “Developer Mode” aan in Discord om IDs te kopieren.

## 5) Environment variabelen
Bestand: `.env`
```
DISCORD_TOKEN=your_bot_token_here
```

## 6) Bot starten
```
node index.js
```

## 7) Slash commands
Bij het opstarten registreert de bot automatisch `/raceincident` commando's.
Zie je ze niet? Herstart de bot en wacht 1–5 minuten.

## 8) Veelvoorkomende problemen
- **Stem-kanaal niet gevonden**: verkeerde ID of bot mist toegang.
- **Geen DM's**: gebruiker heeft DM's uit of bot mist intent.
- **Thread issues**: private threads vereisen dat de bot wordt toegevoegd.

## 9) Snelle checklijst
- Bot invited met juiste permissions
- Message Content Intent aan
- IDs kloppen in `config.json`
- Bot heeft toegang tot alle kanalen/threads
- Bot draait met geldig token
