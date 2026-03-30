# Update Log

## 2026-03-30

### Incident cleanup bij afhandeling
- Afgeronde (`FINALIZED`) en ingetrokken (`WITHDRAWN`) incidenten worden nu echt opgeschoond uit opslag, in plaats van alleen statuswijziging.
- Nieuwe centrale cleanup toegevoegd: `purgeIncident(incidentId, incidentNumber)`.

### Wat `purgeIncident` opruimt
- `data/incidents.json`:
  - verwijdert incident uit `incidents`
  - verwijdert mapping uit `byNumber`
  - verwijdert workflow-referenties in:
    - `pendingEvidence`
    - `pendingIncidentReports`
    - `pendingAppeals`
    - `pendingFinalizations`
    - `pendingWithdrawals`
    - `pendingGuiltyReplies`
- `data/votes.json`:
  - verwijdert stemmen-bucket van het betreffende incident

### Waar dit is gekoppeld
- Finalize-flow gebruikt nu cleanup direct na afhandeling.
- Withdraw-flow gebruikt nu dezelfde cleanup direct na intrekken.

### Extra aanpassing
- Na succesvolle DM-reactie in de guilty-reply flow wordt de pending entry direct verwijderd, zodat deze niet blijft hangen.

### Aangepaste bestanden
- `src/infrastructure/persistence/JsonStore.js`
- `src/infrastructure/discord/interaction.js`
- `src/infrastructure/discord/message.js`
- `test/jsonstore.test.js`

### Tests
- Unit test toegevoegd voor `purgeIncident`.
- Teststatus na wijziging: alle tests geslaagd (`13/13`).

### Eenmalige data-opschoning uitgevoerd
- Bestaande historische `FINALIZED`/`WITHDRAWN` records zijn eenmalig opgeschoond uit:
  - `data/incidents.json`
  - `data/votes.json` (bijbehorende vote-buckets)
- Resultaat van deze run:
  - `removedIncidents`: 2
  - `removedWorkflowEntries`: 1
  - `removedVoteBuckets`: 2
