# Uitleg DRE Race Incident Bot

## Algemene uitleg
De DRE Race Incident Bot ondersteunt het hele incident‑proces in Discord. Rijders kunnen incidenten melden, bewijs uploaden en stewards kunnen stemmen en een besluit nemen. Na afhandeling krijgt de schuldige rijder een directe mogelijkheid om éénmalig zijn/haar visie te geven via een knop bij het afgehandelde incident.

De bot verzorgt:
- een duidelijke meldflow voor incidenten;
- een bewijs‑flow via DM;
- een stemproces voor stewards;
- publicatie van uitslagen in het resolved kanaal (incl. divisie);
- een gecontroleerd wederwoord‑moment voor de schuldige.

## Incident melder – stappen
1) Ga naar het meld‑kanaal en klik op **Meld Incident**.
2) Geef aan in welke divisie je rijdt: **Div 1**, **Div 2**, **Div 3**, **Div 4**.
3) Kies de reden van het incident.
4) Selecteer de schuldige rijder.
5) Vul race‑nummer, ronde en beschrijving in.
6) Controleer je melding en bevestig.
7) Het incident verschijnt in het stewards kanaal met stemknoppen. De divisie wordt meegegeven.
8) Je ontvangt een DM om bewijs te uploaden (link of bijlage). Dit bewijs wordt toegevoegd aan het incident.
9) Na het eindoordeel verschijnt de uitslag in het resolved kanaal, inclusief divisie.

## Incident schuldige – jouw visie geven
Wanneer een incident is afgehandeld:
1) In het afgehandelde incident staat een knop **Wederwoord indienen** met de tekst:
   “Niet eens met dit besluit? Klik hier om je reactie te versturen.”
2) Alleen de schuldige rijder kan deze knop gebruiken.
3) Na het klikken verschijnt een formulier waarin je jouw verhaal en eventueel bewijs kunt delen.
4) Je reactie wordt doorgestuurd naar de stewards als officiële reactie tegenpartij.

Belangrijk:
- Je mag je reactie maar één keer indienen.
- Reactie moet binnen 2 dagen na het incident worden ingestuurd.

## Infographic (Mermaid)
```mermaid
flowchart LR
  A[Incident melder] --> B[Meld incident via knop]
  B --> C[Kies divisie (Div 1-4)]
  C --> D[Kies reden + schuldige]
  D --> E[Vul race/ronde/beschrijving]
  E --> F[Bevestig + upload bewijs (DM)]
  F --> G[Stewards kanaal + divisie]
  G --> H[Stemmen + eindoordeel + divisie]
  H --> I[Resolved kanaal + divisie]
  I --> J[Schuldige: Wederwoord indienen]
  J --> K[Reactie naar stewards]
```

## Infographic (SVG)
![Infographic](infographic.svg)
