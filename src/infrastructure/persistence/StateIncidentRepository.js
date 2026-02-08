const { appendIncidentRow } = require('../../utils/sheets');

class StateIncidentRepository {
  constructor({ config, state }) {
    this.config = config;
    this.state = state;
  }

  async getById(id) {
    return this.state.activeIncidents.get(id) || null;
  }

  async save({ incident, sheetRow }) {
    let sheetRowNumber = null;
    if (sheetRow) {
      sheetRowNumber = await appendIncidentRow({
        config: this.config,
        row: sheetRow
      });
      incident.sheetRowNumber = sheetRowNumber;
    }
    if (incident?.id) {
      this.state.activeIncidents.set(incident.id, incident);
    }
    return incident;
  }

  async listOpen() {
    return [...this.state.activeIncidents.values()];
  }
}

module.exports = { StateIncidentRepository };
