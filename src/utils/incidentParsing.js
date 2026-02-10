function normalizeIncidentNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function extractIncidentNumberFromText(value) {
  const match = String(value || '').match(/INC-\d+/i);
  return match ? match[0].toUpperCase() : '';
}

function normalizeTicketInput(value) {
  const normalized = normalizeIncidentNumber(value);
  if (!normalized) return '';
  if (normalized.startsWith('INC-')) return normalized;
  if (/^\d+$/.test(normalized)) return `INC-${normalized}`;
  return normalized;
}

function getEmbedFieldValue(embed, name) {
  const fields = embed?.fields || [];
  const match = fields.find((field) => field.name === name);
  return match?.value ? String(match.value).trim() : '';
}

function extractIncidentNumberFromEmbed(embed) {
  const fromField = getEmbedFieldValue(embed, '🔢 Incidentnummer');
  if (fromField) return fromField;
  const title = embed?.title || '';
  return extractIncidentNumberFromText(title);
}

function extractUserIdFromText(value) {
  const match = String(value || '').match(/<@!?(\d+)>/);
  return match ? match[1] : null;
}

module.exports = {
  normalizeIncidentNumber,
  extractIncidentNumberFromText,
  normalizeTicketInput,
  getEmbedFieldValue,
  extractIncidentNumberFromEmbed,
  extractUserIdFromText
};
