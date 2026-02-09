# Migration Notes

**Implementation Notes (State + Persistence)**
- Persistent state now lives in `data/`:
  - `data/incidents.json` – incident records + workflow pending state
  - `data/votes.json` – votes per incident
  - `data/counters.json` – incident counter
  - `data/audit.json` – append-only audit trail
- JSON writes are atomic (write temp file + rename) and all read-modify-write operations are file-locked via `proper-lockfile`.
- The in-memory Maps previously used for incidents and pending flows are replaced by a `JsonStore` in `src/infrastructure/persistence/JsonStore.js`.
- Reset state: stop the bot, delete the `data/` directory, restart.
- Backup: copy the entire `data/` directory.

**Replaced State (Old → New)**
- `state.activeIncidents` (Map) → `data/incidents.json` (`incidents` collection)
- `state.pendingEvidence` (Map) → `data/incidents.json` (`workflow.pendingEvidence`)
- `state.pendingIncidentReports` (Map) → `data/incidents.json` (`workflow.pendingIncidentReports`)
- `state.pendingAppeals` (Map) → `data/incidents.json` (`workflow.pendingAppeals`)
- `state.pendingFinalizations` (Map) → `data/incidents.json` (`workflow.pendingFinalizations`)
- `state.pendingGuiltyReplies` (Map of Maps) → `data/incidents.json` (`workflow.pendingGuiltyReplies`)
- `state.pendingWithdrawals` (Map) → `data/incidents.json` (`workflow.pendingWithdrawals`)
- `config.json incidentCounter` → `data/counters.json` (`nextIncidentNumber`)
- Votes stored in embeds → `data/votes.json` (`votes` per incident)

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
