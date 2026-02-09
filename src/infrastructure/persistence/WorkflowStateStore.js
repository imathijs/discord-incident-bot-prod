class WorkflowStateStore {
  constructor({ store }) {
    this.store = store;
  }

  setPendingEvidence(userId, payload) {
    return this.store.setPendingEvidence(userId, payload);
  }

  setPendingAppeal(userId, payload) {
    return this.store.setPendingAppeal(userId, payload);
  }

  clearPendingAppeal(userId) {
    return this.store.deletePendingAppeal(userId);
  }

  setPendingGuiltyReply(userId, incidentKey, payload) {
    return this.store.setPendingGuiltyReply(userId, incidentKey, payload);
  }

  clearPendingIncidentReport(userId) {
    return this.store.deletePendingIncidentReport(userId);
  }
}

module.exports = { WorkflowStateStore };
