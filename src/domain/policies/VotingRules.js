function isStewardAllowedToVote({ stewardId, reporterId, guiltyId }) {
  if (!stewardId) return false;
  return stewardId !== reporterId && stewardId !== guiltyId;
}

module.exports = { isStewardAllowedToVote };
