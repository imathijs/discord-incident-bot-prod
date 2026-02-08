# Migration Notes

**Old → New**
- `src/handlers/interaction.js` → `src/infrastructure/discord/interaction.js`
- `src/handlers/message.js` → `src/infrastructure/discord/message.js`
- `src/utils/evidence.js` `buildEvidencePromptRow` → `src/infrastructure/discord/evidenceUI.js`
- New domain layer: `src/domain/*`
- New application use-cases: `src/application/usecases/*`
- New ports/adapters: `src/application/ports/*`, `src/infrastructure/persistence/*`, `src/infrastructure/discord/*`

**How Use-Cases Are Called**
- `CreateIncident.execute` is called from `src/infrastructure/discord/interaction.js` in `submitIncidentReport`.
- `CastVote.execute` is called from `src/infrastructure/discord/interaction.js` in the vote button handler.
- `FinalizeIncident.execute` is called from `src/infrastructure/discord/interaction.js` in `finalizeWithText`.
- `RequestAccusedResponse.execute` is called from `src/infrastructure/discord/interaction.js` for appeal init and submit.
- `AddEvidence.execute` is called from `src/infrastructure/discord/message.js` before evidence handling.
- `WithdrawIncident.execute` is called from `src/infrastructure/discord/interaction.js` in `withdrawIncidentByNumber`.

**Use-Case Flow (Short)**
- `CreateIncident` – input → thread + sheet row → pending evidence/DM flows
- `CastVote` – validate steward → toggle vote
- `FinalizeIncident` – compute outcome → publish result
- `RequestAccusedResponse` – validate window → pending evidence
- `AddEvidence` – validate pending evidence → process upload
- `WithdrawIncident` – validate reporter → withdraw incident

**TODOs / Next Steps**
- Introduce a proper `IncidentRepository` implementation and stop depending on in-memory maps for recovery.
- Move any remaining Discord-specific formatting into the `NotificationPort` (embeds, threads, DMs) to further thin handlers.
- Add schema validation for `config.json` in `src/infrastructure/config`.
- Add more domain tests (e.g. vote parsing, incident state transitions).
