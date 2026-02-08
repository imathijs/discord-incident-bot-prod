class AddEvidence {
  async execute({ pending, now, channelId, hasEvidencePayload }) {
    if (!pending) return { status: 'skip', reason: 'no_pending' };
    if (!hasEvidencePayload) return { status: 'skip', reason: 'no_payload' };
    if (pending.channelId !== channelId) return { status: 'skip', reason: 'channel_mismatch' };
    if (now > pending.expiresAt) return { status: 'expired' };
    return { status: 'ok' };
  }
}

module.exports = { AddEvidence };
