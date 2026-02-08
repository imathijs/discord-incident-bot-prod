const { DomainError } = require('../../domain/errors/DomainError');

class RequestAccusedResponse {
  async execute({
    mode,
    userId,
    guiltyId,
    pending,
    incidentNumberInput,
    now,
    appealWindowMs,
    evidenceWindowMs,
    voteThreadId,
    dmChannelId,
    appealMessageId,
    validateOnly
  }) {
    if (mode === 'init') {
      if (!guiltyId || userId !== guiltyId) {
        throw new DomainError('Only guilty driver can submit appeal', 'NOT_ALLOWED');
      }
      return {
        expiresAt: now + appealWindowMs,
        incidentNumber: incidentNumberInput || '',
        allowedGuiltyId: guiltyId,
        source: 'resolved'
      };
    }

    if (!pending) {
      throw new DomainError('No pending appeal', 'NO_PENDING');
    }
    if (now > pending.expiresAt) {
      throw new DomainError('Appeal expired', 'EXPIRED');
    }
    if (pending.allowedGuiltyId && pending.allowedGuiltyId !== userId) {
      throw new DomainError('Not allowed to submit appeal', 'NOT_ALLOWED');
    }

    const incidentNumber = pending.incidentNumber || incidentNumberInput || '';
    if (!incidentNumber) {
      throw new DomainError('Missing incident number', 'MISSING_INCIDENT');
    }

    if (validateOnly) {
      return { incidentNumber, evidencePayload: null, hasDm: Boolean(dmChannelId) };
    }

    const evidencePayload = dmChannelId
      ? {
          messageId: appealMessageId,
          voteThreadId: voteThreadId || null,
          channelId: dmChannelId,
          expiresAt: now + evidenceWindowMs,
          type: 'appeal',
          incidentNumber,
          botMessageIds: []
        }
      : null;

    return { incidentNumber, evidencePayload, hasDm: Boolean(dmChannelId) };
  }
}

module.exports = { RequestAccusedResponse };
