# Uitleg DRE Race Incident Bot

## Algemene uitleg
De DRE Race Incident Bot ondersteunt het hele incident‑proces in Discord. Rijders kunnen incidenten melden, bewijs uploaden en stewards kunnen stemmen en een besluit nemen. De schuldige rijder kan tijdens de behandeling éénmalig reageren via DM (binnen 2 dagen).

De bot verzorgt:
- een duidelijke meldflow voor incidenten;
- een bewijs‑flow via DM;
- een stemproces voor stewards;
- publicatie van uitslagen in het resolved kanaal (incl. divisie);
- optionele logging van incidenten in Google Sheets (status wordt bijgewerkt bij afhandeling);
- een optionele DM‑reactie van de schuldige tijdens de behandeling.

## Incident melder – stappen
1) Ga naar het meld‑kanaal en klik op **Meld Incident**.
2) Geef aan in welke divisie je rijdt: **Div 1**, **Div 2**, **Div 3**, **Div 4**.
3) Kies de reden van het incident.
4) Selecteer de schuldige rijder.
5) Vul race‑nummer, ronde, bocht en beschrijving in.
6) Controleer je melding en bevestig.
7) Het incident verschijnt als forum‑post in het stewards forumkanaal met een eigen thread + stemknoppen. De divisie wordt meegegeven.
8) Je ontvangt een DM om bewijs te uploaden (link of bijlage). Dit bewijs komt zichtbaar in de incident‑thread.
9) Na het eindoordeel verschijnt de uitslag in het resolved kanaal, inclusief divisie.

## How‑to: incident terugnemen (leden)
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
- `resolvedThreadId` – thread voor besluiten (optioneel)
- `incidentChatChannelId` – kanaal waar @bot berichten terechtkomen
- `stewardRoleId` – rol-ID voor stewards
- `allowedGuildId` – server-ID waar de bot is toegestaan (laat leeg voor alle servers)
- `incidentCounter` – teller voor incidentnummers (`INC-xxxxx`)
- `autoDeleteHours` – auto‑delete van DM‑berichten/opties

## Infographic (Mermaid)
```mermaid
flowchart LR
  A[Incident melder] --> B[Meld incident via knop]
  B --> C[Kies divisie (Div 1-4)]
  C --> D[Kies reden + schuldige]
  D --> E[Vul race/ronde/bocht/beschrijving]
  E --> F[Bevestig + upload bewijs (DM)]
  F --> G[Forum post + incident thread]
  G --> H[Bewijs naar incident thread]
  H --> I[Stemmen + eindoordeel + divisie]
  I --> J[Resolved kanaal + divisie]
```

## Infographic (SVG)
![Infographic](infographic.svg)
