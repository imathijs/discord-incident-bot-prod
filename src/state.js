function createState(config) {
  const autoDeleteHours = Number(config.autoDeleteHours) || 0;
  const autoDeleteMs = autoDeleteHours > 0 ? autoDeleteHours * 60 * 60 * 1000 : 0;

  return {
    activeIncidents: new Map(),
    pendingEvidence: new Map(),
    pendingIncidentReports: new Map(),
    pendingAppeals: new Map(),
    pendingFinalizations: new Map(),
    pendingGuiltyReplies: new Map(),
    pendingWithdrawals: new Map(),
    autoDeleteMs
  };
}

module.exports = { createState };
