---
name: dre-race-incident-bot
description: Gebruik deze skill wanneer je werkt aan de DRE Race Incident Bot in deze repository. Deze skill is bedoeld voor wijzigingen aan Discord incidentflows, steward-stemmen, evidence/DM-afhandeling, incident-cleanup, config-validatie en projectdocumentatie.
---

# DRE Race Incident Bot

Gebruik deze skill voor alle wijzigingen in deze repo waarbij incidentflows, stewardacties, Discord-interacties of documentatie betrokken zijn.

## Doel van de bot

De bot ondersteunt het volledige incidentproces:
- melding door rijder of steward;
- bewijsflow via DM;
- stemming door stewards;
- eindoordeel publiceren;
- intrekken door indiener;
- afsluiten door steward;
- optionele logging naar Google Sheets.

## Kernstructuur

- `src/infrastructure/discord/interaction.js`
  Hier zitten vrijwel alle slash commands, buttons, modals en flow-orkestratie.
- `src/infrastructure/discord/message.js`
  Hier zit DM- en message-afhandeling voor bewijs, reacties en follow-up berichten.
- `src/infrastructure/discord/DiscordNotificationPort.js`
  Bouwt incident-embeds, threads, stemknoppen en steward-control-rows.
- `src/infrastructure/persistence/JsonStore.js`
  Persistente incident-, vote- en workflow-state. `purgeIncident` is leidend voor cleanup.
- `src/application/usecases/`
  Domeinlogica zoals `CreateIncident`, `CastVote`, `FinalizeIncident`, `WithdrawIncident`.
- `src/config/index.js` en `src/config/schema.js`
  Centrale config loader en validatie.

## Leidende flows

### Incident melden

1. Start via `/raceincident melden` of steward-variant.
2. Input wordt als pending workflow-state opgeslagen.
3. Incident wordt geplaatst als forum-post/thread in het vote-kanaal.
4. Evidence en DM-follow-up worden gestart.

Bij wijzigingen aan de meldflow moet je meestal zowel `interaction.js` als `DiscordNotificationPort.js` controleren.

### Stemmen en afhandelen

1. Stemknoppen leven op het incidentbericht.
2. Steward-controls leven in een aparte row met:
   - `Incident Afhandelen`
   - `Incident Afsluiten`
   - `Toon cheatsheet`
3. Afhandelen gebruikt preview + modal + publicatie naar resolved kanaal/thread.

Bij wijzigingen aan steward-controls moet je zowel de builder in `interaction.js` als die in `DiscordNotificationPort.js` synchroon houden.

### Incident intrekken

1. Alleen de oorspronkelijke indiener mag dit doen.
2. Intrekken vraagt optioneel om een reden.
3. Na intrekken wordt stem-state en workflow-state verwijderd via `store.purgeIncident(...)`.

### Incident afsluiten door steward

1. Alleen stewards mogen dit doen.
2. `Incident Afsluiten` vraagt verplicht om een reden.
3. Het incident krijgt status `⛔`, stemcomponenten verdwijnen en het incident wordt opgeruimd.
4. Gebruik voor cleanup altijd de bestaande incident-opruiming via `purgeIncident`; maak geen losse handmatige partial cleanup.

## Werkregels voor wijzigingen

- Zoek eerst of een flow al bestaat voordat je een tweede variant toevoegt.
- Houd custom IDs centraal in `src/ids.js`.
- Nieuwe pending workflow-state moet ook:
  - een getter/setter/delete krijgen in `JsonStore.js`;
  - worden meegenomen in `getDefaultIncidents()`;
  - worden meegenomen in `purgeIncident(...)` als die state aan een incident gekoppeld is.
- Pas bij nieuwe steward-knoppen meestal beide builders aan:
  - `interaction.js`
  - `DiscordNotificationPort.js`
- Als een incident “echt klaar” is, ruim dan zowel incident, votes als workflow references op.
- Regressies ontstaan hier meestal door:
  - een knop-ID die maar op één plek is toegevoegd;
  - pending state die niet wordt verwijderd;
  - embed-update zonder threadnaam/status-update;
  - docs die achterlopen op de echte flow.

## Documentatie die je meestal ook moet bijwerken

Werk bij flowwijzigingen meestal ook deze bestanden bij:
- `README.md`
- `UITLEG_BOT.md`
- eventueel `DISCORD_CHEATSHEET.md` of `GOOGLE_SHEETS_CHEATSHEET.md` als permissies of sheetgedrag veranderen.

## Validatie

Na logische wijzigingen:
- draai minimaal `npm test -- --runInBand`
- bij store-cleanup: controleer `test/jsonstore.test.js`
- bij interaction-/message-flows: controleer ook `test/message.test.js`

## Praktische aanwijzing

Als je een incidentflow wijzigt, controleer altijd deze vier punten:
- welke knop/modal/select start de flow;
- waar pending state wordt opgeslagen;
- hoe status/embed/threadnaam worden aangepast;
- of `purgeIncident` of andere cleanup nog volledig klopt.
