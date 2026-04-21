function readVoteValue(entry, prefix, key) {
  if (!prefix) return entry[key];
  const prop = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
  return entry[prop];
}

function buildCategoryCounts(votes, prefix = '') {
  const counts = { cat0: 0, cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 };
  for (const v of Object.values(votes)) {
    const category = readVoteValue(v, prefix, 'category');
    if (category && counts[category] !== undefined) counts[category]++;
  }
  return counts;
}

function normalizeCategoryOverride(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return /^cat[0-5]$/.test(normalized) ? normalized : null;
}

function computePenaltyPoints(votes, prefix = '') {
  let penaltyPoints = 0;
  for (const v of Object.values(votes)) {
    if (readVoteValue(v, prefix, 'plus')) penaltyPoints += 1;
    if (readVoteValue(v, prefix, 'minus')) penaltyPoints -= 1;
  }
  return penaltyPoints;
}

function buildTallyText(votes, prefix = '') {
  const catCount = buildCategoryCounts(votes, prefix);
  const penaltyPoints = computePenaltyPoints(votes, prefix);

  const lines = [
    `CAT0: ${catCount.cat0}`,
    `CAT1: ${catCount.cat1}`,
    `CAT2: ${catCount.cat2}`,
    `CAT3: ${catCount.cat3}`,
    `CAT4: ${catCount.cat4}`,
    `CAT5: ${catCount.cat5}`,
    ``,
    `Strafmaat: ${penaltyPoints}`
  ];

  return lines.join('\n');
}

function mostVotedCategory(votes, prefix = '') {
  const counts = buildCategoryCounts(votes, prefix);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [winner, voteCount] = sorted[0];
  if (!voteCount || voteCount === 0) return null;
  return winner;
}

function resolveCategoryDecision(votes, { prefix = '', overrideCategory } = {}) {
  const counts = buildCategoryCounts(votes, prefix);
  const highestVoteCount = Math.max(...Object.values(counts));
  const winners = Object.entries(counts)
    .filter(([, count]) => count === highestVoteCount)
    .map(([category]) => category);
  const hasTie = winners.length > 1;
  const normalizedOverride = normalizeCategoryOverride(overrideCategory);
  const winner = highestVoteCount > 0 && !hasTie ? winners[0] : null;

  if (hasTie && normalizedOverride) {
    return {
      counts,
      highestVoteCount,
      winners,
      hasTie,
      usedOverride: true,
      decision: normalizedOverride
    };
  }

  return {
    counts,
    highestVoteCount,
    winners,
    hasTie,
    usedOverride: false,
    decision: winner
  };
}

module.exports = {
  buildTallyText,
  computePenaltyPoints,
  mostVotedCategory,
  normalizeCategoryOverride,
  resolveCategoryDecision
};
