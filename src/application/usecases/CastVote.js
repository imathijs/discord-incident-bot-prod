const { DomainError } = require('../../domain/errors/DomainError');
const { isStewardAllowedToVote } = require('../../domain/policies/VotingRules');

class CastVote {
  async execute({ incidentData, voterId, action, target, category }) {
    const allowed = isStewardAllowedToVote({
      stewardId: voterId,
      reporterId: incidentData?.reporterId,
      guiltyId: incidentData?.guiltyId
    });
    if (!allowed) {
      throw new DomainError('Voter involved with incident', 'VOTER_INVOLVED');
    }

    if (action === 'validate') {
      return { allowed: true };
    }

    if (!incidentData.votes[voterId]) {
      incidentData.votes[voterId] = {
        category: null,
        plus: false,
        minus: false,
        reporterCategory: null,
        reporterPlus: false,
        reporterMinus: false
      };
    }

    const entry = incidentData.votes[voterId];
    if (action === 'category') {
      if (target === 'reporter') {
        const isSame = entry.reporterCategory === category;
        entry.reporterCategory = isSame ? null : category;
        return { entry, isSame };
      }
      const isSame = entry.category === category;
      entry.category = isSame ? null : category;
      return { entry, isSame };
    }

    if (action === 'plus') {
      if (target === 'reporter') {
        entry.reporterPlus = !entry.reporterPlus;
        if (entry.reporterPlus) entry.reporterMinus = false;
        return { entry };
      }
      entry.plus = !entry.plus;
      if (entry.plus) entry.minus = false;
      return { entry };
    }

    if (action === 'minus') {
      if (target === 'reporter') {
        entry.reporterMinus = !entry.reporterMinus;
        if (entry.reporterMinus) entry.reporterPlus = false;
        return { entry };
      }
      entry.minus = !entry.minus;
      if (entry.minus) entry.plus = false;
      return { entry };
    }

    throw new DomainError('Unknown vote action', 'UNKNOWN_VOTE_ACTION');
  }
}

module.exports = { CastVote };
