const { buildTallyText, computePenaltyPoints, mostVotedCategory } = require('../../utils/votes');

class FinalizeIncident {
  async execute({ incidentData, finalText }) {
    const tally = buildTallyText(incidentData.votes);
    const winner = mostVotedCategory(incidentData.votes);
    const decision = winner ? winner.toUpperCase() : 'CAT0';
    const penaltyPoints = computePenaltyPoints(incidentData.votes);

    const reporterTally = buildTallyText(incidentData.votes, 'reporter');
    const reporterWinner = mostVotedCategory(incidentData.votes, 'reporter');
    const reporterDecision = reporterWinner ? reporterWinner.toUpperCase() : 'CAT0';
    const reporterPenaltyPoints = computePenaltyPoints(incidentData.votes, 'reporter');

    let finalTextValue = finalText;
    if (decision === 'CAT0') finalTextValue = 'No futher action';

    return {
      tally,
      decision,
      penaltyPoints,
      reporterTally,
      reporterDecision,
      reporterPenaltyPoints,
      finalTextValue
    };
  }
}

module.exports = { FinalizeIncident };
