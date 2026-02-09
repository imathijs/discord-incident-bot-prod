const fs = require('node:fs');
const path = require('node:path');
const { configSchema } = require('./schema');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../config.json');

class ConfigValidationError extends Error {
  constructor(message, { details } = {}) {
    super(message);
    this.name = 'ConfigValidationError';
    this.details = details || [];
  }
}

function readConfigFile(configPath) {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new ConfigValidationError(
        `Config file ontbreekt op ${configPath}. Maak config.json aan met de niet-geheime Discord IDs.`
      );
    }
    if (err instanceof SyntaxError) {
      throw new ConfigValidationError(`Config file bevat ongeldige JSON: ${configPath}`);
    }
    throw new ConfigValidationError(`Config file kon niet gelezen worden: ${configPath}`);
  }
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function envString(env, key) {
  if (!Object.prototype.hasOwnProperty.call(env, key)) return undefined;
  return env[key];
}

function envStringOrUndefined(env, key) {
  const raw = envString(env, key);
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseBooleanFromAny(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return value;
}

function parseIntegerFromAny(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}

function pickValue(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function resolveAllowedGuild({ env, fileConfig, nodeEnv }) {
  const envAllowedGuildRaw = envString(env, 'ALLOWED_GUILD_ID');
  if (envAllowedGuildRaw !== undefined) {
    return {
      allowedGuildId: String(envAllowedGuildRaw).trim(),
      allowedGuildSource: 'env'
    };
  }

  if (nodeEnv === 'development') {
    const fromFile = normalizeOptionalString(fileConfig.allowedGuildId);
    if (fromFile) {
      return {
        allowedGuildId: fromFile,
        allowedGuildSource: 'config.json'
      };
    }
  }

  return {
    allowedGuildId: null,
    allowedGuildSource: 'none'
  };
}

function formatValidationDetails(details) {
  return details.map((detail) => {
    const key = detail.path && detail.path.length > 0 ? detail.path.join('.') : 'config';
    const message = detail.message.replace(/^"|"$/g, '');
    return `- ${key}: ${message}`;
  });
}

function buildCandidateConfig({ env, fileConfig }) {
  const nodeEnv = envStringOrUndefined(env, 'NODE_ENV') || 'production';
  const allowedGuild = resolveAllowedGuild({ env, fileConfig, nodeEnv });

  const candidate = {
    nodeEnv,
    discordToken: envString(env, 'DISCORD_TOKEN'),

    reportChannelId: pickValue(envStringOrUndefined(env, 'REPORT_CHANNEL_ID'), fileConfig.reportChannelId),
    voteChannelId: pickValue(envStringOrUndefined(env, 'VOTE_CHANNEL_ID'), fileConfig.voteChannelId),
    stewardFinalizeChannelId: normalizeOptionalString(
      pickValue(envString(env, 'STEWARD_FINALIZE_CHANNEL_ID'), fileConfig.stewardFinalizeChannelId)
    ),
    stewardRoleId: pickValue(envStringOrUndefined(env, 'STEWARD_ROLE_ID'), fileConfig.stewardRoleId),
    incidentStewardRoleId: pickValue(
      envStringOrUndefined(env, 'INCIDENT_STEWARD_ROLE_ID'),
      fileConfig.incidentStewardRoleId
    ),
    autoDeleteHours: parseIntegerFromAny(
      pickValue(envStringOrUndefined(env, 'AUTO_DELETE_HOURS'), fileConfig.autoDeleteHours, 0)
    ),
    resolvedChannelId: pickValue(envStringOrUndefined(env, 'RESOLVED_CHANNEL_ID'), fileConfig.resolvedChannelId),
    resolvedThreadId: normalizeOptionalString(
      pickValue(envString(env, 'RESOLVED_THREAD_ID'), fileConfig.resolvedThreadId)
    ),
    withdrawNoticeChannelId: normalizeOptionalString(
      pickValue(envString(env, 'WITHDRAW_NOTICE_CHANNEL_ID'), fileConfig.withdrawNoticeChannelId)
    ),
    incidentChatChannelId: pickValue(
      envStringOrUndefined(env, 'INCIDENT_CHAT_CHANNEL_ID'),
      fileConfig.incidentChatChannelId
    ),
    incidentCounter: parseIntegerFromAny(
      pickValue(envStringOrUndefined(env, 'INCIDENT_COUNTER'), fileConfig.incidentCounter)
    ),

    allowedGuildId: allowedGuild.allowedGuildId,
    allowedGuildSource: allowedGuild.allowedGuildSource,
    guildAccessMode: allowedGuild.allowedGuildId ? 'locked' : 'deny_all',

    googleSheetsEnabled: parseBooleanFromAny(
      pickValue(envString(env, 'GOOGLE_SHEETS_ENABLED'), fileConfig.googleSheetsEnabled, false)
    ),
    googleSheetsSpreadsheetId: normalizeOptionalString(
      pickValue(envString(env, 'GOOGLE_SHEETS_SPREADSHEET_ID'), fileConfig.googleSheetsSpreadsheetId)
    ),
    googleSheetsSheetName: normalizeOptionalString(
      pickValue(envString(env, 'GOOGLE_SHEETS_SHEET_NAME'), fileConfig.googleSheetsSheetName)
    ),

    googleServiceAccountJson: normalizeOptionalString(envString(env, 'GOOGLE_SERVICE_ACCOUNT_JSON')),
    googleServiceAccountB64: normalizeOptionalString(envString(env, 'GOOGLE_SERVICE_ACCOUNT_B64')),
    googleServiceAccountFile: normalizeOptionalString(envString(env, 'GOOGLE_SERVICE_ACCOUNT_FILE'))
  };

  return candidate;
}

function loadConfig(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const env = options.env || process.env;
  const fileConfig = readConfigFile(configPath);
  const candidate = buildCandidateConfig({ env, fileConfig });

  const { value, error } = configSchema.validate(candidate);
  if (error) {
    const formatted = formatValidationDetails(error.details || []);
    const message = ['Configuratie validatie mislukt:', ...formatted].join('\n');
    throw new ConfigValidationError(message, { details: error.details || [] });
  }

  return Object.freeze(value);
}

module.exports = {
  loadConfig,
  ConfigValidationError
};
