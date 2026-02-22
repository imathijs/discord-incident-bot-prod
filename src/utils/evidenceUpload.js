const DEFAULT_BASE_URL = 'https://uploadbewijs.dutchraceevents.com';
const DEFAULT_TTL_MS = 60 * 60 * 1000;

class EvidenceUploadError extends Error {
  constructor(message, code = 'EVIDENCE_UPLOAD_FAILED') {
    super(message);
    this.name = 'EvidenceUploadError';
    this.code = code;
  }
}

const joinBaseUrl = (baseUrl, suffix) => {
  const normalized = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return `${normalized}${suffix}`;
};

function extractToken(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.token === 'string' && payload.token.trim()) return payload.token.trim();
  if (typeof payload.uploadToken === 'string' && payload.uploadToken.trim()) return payload.uploadToken.trim();
  if (payload.data && typeof payload.data === 'object') {
    if (typeof payload.data.token === 'string' && payload.data.token.trim()) return payload.data.token.trim();
    if (typeof payload.data.uploadToken === 'string' && payload.data.uploadToken.trim()) {
      return payload.data.uploadToken.trim();
    }
  }
  return null;
}

async function createExternalEvidenceUploadLink({
  incidentNumber,
  bearerToken,
  ttlMs = DEFAULT_TTL_MS,
  baseUrl = DEFAULT_BASE_URL
}) {
  const normalizedIncident = String(incidentNumber || '').trim().toUpperCase();
  if (!normalizedIncident) {
    throw new EvidenceUploadError('Incidentnummer ontbreekt.', 'MISSING_INCIDENT_NUMBER');
  }

  const authToken = String(bearerToken || '').trim();
  if (!authToken) {
    throw new EvidenceUploadError('Uploadservice is niet geconfigureerd.', 'MISSING_AUTH_TOKEN');
  }

  if (typeof fetch !== 'function') {
    throw new EvidenceUploadError('Fetch API niet beschikbaar in deze Node-runtime.', 'FETCH_UNAVAILABLE');
  }

  const endpoint = joinBaseUrl(baseUrl, '/getuploadtoken.json');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      incidentNumber: normalizedIncident,
      ttlMs
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EvidenceUploadError(
      `Uploadtoken ophalen mislukt (${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
      'TOKEN_REQUEST_FAILED'
    );
  }

  const payload = await response.json().catch(() => null);
  const token = extractToken(payload);
  if (!token) {
    throw new EvidenceUploadError('Uploadtoken ontbreekt in API response.', 'TOKEN_MISSING');
  }

  const uploadBase = joinBaseUrl(baseUrl, '/');
  const uploadUrl = `${uploadBase}?incident=${encodeURIComponent(normalizedIncident)}&token=${encodeURIComponent(token)}`;
  return {
    incidentNumber: normalizedIncident,
    token,
    ttlMs,
    uploadUrl
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_TTL_MS,
  EvidenceUploadError,
  createExternalEvidenceUploadLink
};
