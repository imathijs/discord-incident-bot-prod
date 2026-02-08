class WorkflowStateStore {
  constructor({ state }) {
    this.state = state;
  }

  setPendingEvidence(userId, payload) {
    this.state.pendingEvidence.set(userId, payload);
  }

  setPendingAppeal(userId, payload) {
    this.state.pendingAppeals.set(userId, payload);
  }

  clearPendingAppeal(userId) {
    this.state.pendingAppeals.delete(userId);
  }

  setPendingGuiltyReply(userId, incidentKey, payload) {
    const map = this.state.pendingGuiltyReplies.get(userId) || new Map();
    map.set(incidentKey, payload);
    this.state.pendingGuiltyReplies.set(userId, map);
  }

  clearPendingIncidentReport(userId) {
    this.state.pendingIncidentReports.delete(userId);
  }
}

module.exports = { WorkflowStateStore };
