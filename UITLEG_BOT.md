# Uitleg DRE Race Incident Bot

## Algemene uitleg
De DRE Race Incident Bot ondersteunt het hele incident‑proces in Discord. Rijders kunnen incidenten melden, bewijs uploaden en stewards kunnen stemmen en een besluit nemen. Na afhandeling krijgt de schuldige rijder een directe mogelijkheid om éénmalig zijn/haar visie te geven via een knop bij het afgehandelde incident.

De bot verzorgt:
- een duidelijke meldflow voor incidenten;
- een bewijs‑flow via DM;
- een stemproces voor stewards;
- publicatie van uitslagen in het resolved kanaal;
- een gecontroleerd wederwoord‑moment voor de schuldige.

## Incident melder – stappen
1) Ga naar het meld‑kanaal en klik op **Meld Incident**.
2) Kies de reden van het incident.
3) Selecteer de schuldige rijder.
4) Vul race‑nummer, ronde en beschrijving in.
5) Controleer je melding en bevestig.
6) Het incident verschijnt in het stewards kanaal met stemknoppen.
7) Je ontvangt een DM om bewijs te uploaden (link of bijlage). Dit bewijs wordt toegevoegd aan het incident.

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
  B --> C[Kies reden + schuldige]
  C --> D[Vul race/ronde/beschrijving]
  D --> E[Bevestig + upload bewijs (DM)]
  E --> F[Stewards kanaal]
  F --> G[Stemmen + eindoordeel]
  G --> H[Resolved kanaal]
  H --> I[Schuldige: Wederwoord indienen]
  I --> J[Reactie naar stewards]
```

## Infographic (SVG)
![Infographic](infographic.svg)
