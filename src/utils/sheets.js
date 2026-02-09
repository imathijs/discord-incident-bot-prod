const fs = require('node:fs');
const { google } = require('googleapis');

let cachedClient = null;
const HEADER_ROW = [
  'Status',
  'Datum',
  'Divisie',
  'Schuldige',
  'Indiener',
  'Race',
  'Ronde',
  'Circuit',
  'Categorie',
  'Verhaal',
  'Steward verslag'
];

function getCredentials(config) {
  const rawJson = config?.googleServiceAccountJson;
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch (err) {
      console.error('Google Sheets: JSON parse error in GOOGLE_SERVICE_ACCOUNT_JSON');
      return null;
    }
  }

  const b64 = config?.googleServiceAccountB64;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (err) {
      console.error('Google Sheets: base64 parse error in GOOGLE_SERVICE_ACCOUNT_B64');
      return null;
    }
  }

  const filePath = config?.googleServiceAccountFile;
  if (filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.error('Google Sheets: cannot read GOOGLE_SERVICE_ACCOUNT_FILE');
      return null;
    }
  }

  return null;
}

function isSheetsEnabled(config) {
  return (
    config?.googleSheetsEnabled &&
    config?.googleSheetsSpreadsheetId &&
    config?.googleSheetsSheetName
  );
}

function getSheetsClient(config) {
  if (cachedClient) return cachedClient;
  const credentials = getCredentials(config);
  if (!credentials) return null;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

function toA1SheetName(sheetName) {
  if (!sheetName) return '';
  const escaped = String(sheetName).replace(/'/g, "''");
  return `'${escaped}'`;
}

function extractRowNumber(updatedRange) {
  if (!updatedRange) return null;
  const match = updatedRange.match(/!A(\d+)/);
  if (!match) return null;
  return Number(match[1]) || null;
}

async function ensureHeaderRow({ client, sheetName, spreadsheetId }) {
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:K1`
    });
    const values = res?.data?.values?.[0] || [];
    const hasAny = values.some((value) => String(value || '').trim() !== '');
    if (hasAny) return;

    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:K1`,
      valueInputOption: 'RAW',
      resource: { values: [HEADER_ROW] }
    });
  } catch (err) {
    console.error('Google Sheets: header check failed', err?.message || err);
  }
}

async function appendIncidentRow({ config, row }) {
  if (!isSheetsEnabled(config)) return null;
  const client = getSheetsClient(config);
  if (!client) return null;
  const sheetName = toA1SheetName(config.googleSheetsSheetName);
  await ensureHeaderRow({
    client,
    sheetName,
    spreadsheetId: config.googleSheetsSpreadsheetId
  });

  try {
    const res = await client.spreadsheets.values.append({
      spreadsheetId: config.googleSheetsSpreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [row] }
    });
    return extractRowNumber(res?.data?.updates?.updatedRange);
  } catch (err) {
    console.error('Google Sheets: append failed', err?.message || err);
    return null;
  }
}

async function updateIncidentStatus({ config, rowNumber, status }) {
  if (!isSheetsEnabled(config) || !rowNumber) return false;
  const client = getSheetsClient(config);
  if (!client) return false;
  const sheetName = toA1SheetName(config.googleSheetsSheetName);

  try {
    await client.spreadsheets.values.update({
      spreadsheetId: config.googleSheetsSpreadsheetId,
      range: `${sheetName}!A${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[status]] }
    });
    return true;
  } catch (err) {
    console.error('Google Sheets: status update failed', err?.message || err);
    return false;
  }
}

async function updateIncidentResolution({ config, rowNumber, status, stewardReport }) {
  if (!isSheetsEnabled(config) || !rowNumber) return false;
  const client = getSheetsClient(config);
  if (!client) return false;
  const sheetName = toA1SheetName(config.googleSheetsSheetName);

  try {
    await client.spreadsheets.values.batchUpdate({
      spreadsheetId: config.googleSheetsSpreadsheetId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `${sheetName}!A${rowNumber}`, values: [[status]] },
          { range: `${sheetName}!K${rowNumber}`, values: [[stewardReport || '']] }
        ]
      }
    });
    return true;
  } catch (err) {
    console.error('Google Sheets: resolution update failed', err?.message || err);
    return false;
  }
}

module.exports = {
  appendIncidentRow,
  updateIncidentStatus,
  updateIncidentResolution
};
