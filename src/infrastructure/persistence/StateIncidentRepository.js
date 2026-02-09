const { appendIncidentRow } = require('../../utils/sheets');

class StateIncidentRepository {
  constructor({ config, store }) {
    this.config = config;
    this.store = store;
  }

  async getById(id) {
    return this.store.getIncident(id);
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
    if (!incident?.status) incident.status = 'OPEN';
    if (!incident?.createdAt) incident.createdAt = Date.now();
    return this.store.saveIncident(incident);
  }

  async listOpen() {
    return this.store.listOpenIncidents();
  }
}

module.exports = { StateIncidentRepository };
