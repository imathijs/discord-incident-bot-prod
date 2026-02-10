class WorkflowStateStore {
  constructor({ store }) {
    this.store = store;
  }

  callStore(method, ...args) {
    return this.store[method](...args);
  }

  setPendingEvidence(userId, payload) {
    return this.callStore('setPendingEvidence', userId, payload);
  }

  setPendingAppeal(userId, payload) {
    return this.callStore('setPendingAppeal', userId, payload);
  }

  clearPendingAppeal(userId) {
    return this.callStore('deletePendingAppeal', userId);
  }

  setPendingGuiltyReply(userId, incidentKey, payload) {
    return this.callStore('setPendingGuiltyReply', userId, incidentKey, payload);
  }

  clearPendingIncidentReport(userId) {
    return this.callStore('deletePendingIncidentReport', userId);
  }
}

module.exports = { WorkflowStateStore };
