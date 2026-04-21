const { buildTallyText, computePenaltyPoints, resolveCategoryDecision } = require('../../utils/votes');

class FinalizeIncident {
  async execute({ incidentData, finalText, decisionOverrides = {} }) {
    const tally = buildTallyText(incidentData.votes);
    const guiltyDecision = resolveCategoryDecision(incidentData.votes, {
      overrideCategory: decisionOverrides.guilty
    });
    const decision = guiltyDecision.decision ? guiltyDecision.decision.toUpperCase() : 'CAT0';
    const penaltyPoints = computePenaltyPoints(incidentData.votes);

    const reporterTally = buildTallyText(incidentData.votes, 'reporter');
    const reporterDecisionResult = resolveCategoryDecision(incidentData.votes, {
      prefix: 'reporter',
      overrideCategory: decisionOverrides.reporter
    });
    const reporterDecision = reporterDecisionResult.decision ? reporterDecisionResult.decision.toUpperCase() : 'CAT0';
    const reporterPenaltyPoints = computePenaltyPoints(incidentData.votes, 'reporter');

    return {
      tally,
      decision,
      penaltyPoints,
      reporterTally,
      reporterDecision,
      reporterPenaltyPoints,
      finalTextValue: finalText,
      guiltyDecisionMeta: guiltyDecision,
      reporterDecisionMeta: reporterDecisionResult
    };
  }
}

module.exports = { FinalizeIncident };
