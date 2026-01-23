function readVoteValue(entry, prefix, key) {
  if (!prefix) return entry[key];
  const prop = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
  return entry[prop];
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
  const catCount = { cat0: 0, cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 };
  const penaltyPoints = computePenaltyPoints(votes, prefix);
  for (const v of Object.values(votes)) {
    const category = readVoteValue(v, prefix, 'category');
    if (category && catCount[category] !== undefined) catCount[category]++;
  }

  const lines = [
    `CAT0: ${catCount.cat0}`,
    `CAT1: ${catCount.cat1}`,
    `CAT2: ${catCount.cat2}`,
    `CAT3: ${catCount.cat3}`,
    `CAT4: ${catCount.cat4}`,
    `CAT5: ${catCount.cat5}`,
    ``,
    `Netto strafpunten: **${penaltyPoints}**`
  ];

  return lines.join('\n');
}

function mostVotedCategory(votes, prefix = '') {
  const counts = { cat0: 0, cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 };

  for (const v of Object.values(votes)) {
    const category = readVoteValue(v, prefix, 'category');
    if (category && counts[category] !== undefined) counts[category]++;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [winner, voteCount] = sorted[0];
  if (!voteCount || voteCount === 0) return null;
  return winner;
}

module.exports = {
  buildTallyText,
  computePenaltyPoints,
  mostVotedCategory
};
