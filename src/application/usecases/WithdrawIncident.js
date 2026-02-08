const { DomainError } = require('../../domain/errors/DomainError');

class WithdrawIncident {
  async execute({ incidentData, userId, userTag }) {
    const reporterId = incidentData?.reporterId;
    const reporterTag = incidentData?.reporter;

    if (userId !== reporterId) {
      throw new DomainError('Only reporter can withdraw', 'NOT_REPORTER');
    }

    const isReporter =
      (reporterId && reporterId === userId) ||
      (!reporterId && reporterTag && reporterTag === userTag);

    if (!isReporter) {
      throw new DomainError('Only reporter can withdraw', 'NOT_REPORTER');
    }

    return { ok: true };
  }
}

module.exports = { WithdrawIncident };
