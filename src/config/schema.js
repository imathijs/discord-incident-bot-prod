const Joi = require('joi');

const DISCORD_SNOWFLAKE_PATTERN = /^\d{16,20}$/;
const RESERVED_ID_VALUES = new Set(['0', 'undefined', 'null']);

function isReservedId(value) {
  return RESERVED_ID_VALUES.has(String(value || '').trim().toLowerCase());
}

const snowflakeId = Joi.string()
  .trim()
  .pattern(DISCORD_SNOWFLAKE_PATTERN)
  .custom((value, helpers) => {
    if (isReservedId(value)) {
      return helpers.error('snowflake.reserved');
    }
    return value;
  }, 'Discord snowflake self-check')
  .messages({
    'string.base': 'must be a string',
    'string.empty': 'must not be empty',
    'string.pattern.base': 'must look like a Discord snowflake (16-20 digits)',
    'any.required': 'is required',
    'snowflake.reserved': 'must not be 0, "undefined" or "null"'
  });

const optionalSnowflakeId = Joi.alternatives().try(snowflakeId, Joi.valid(null)).default(null);

const configSchema = Joi.object({
  nodeEnv: Joi.string().trim().default('production'),
  discordToken: Joi.string().trim().min(1).required().messages({
    'string.empty': 'must not be empty',
    'any.required': 'is required'
  }),

  reportChannelId: snowflakeId.required(),
  voteChannelId: snowflakeId.required(),
  stewardFinalizeChannelId: optionalSnowflakeId,
  stewardRoleId: snowflakeId.required(),
  incidentStewardRoleId: snowflakeId.required(),
  autoDeleteHours: Joi.number().integer().min(0).required(),
  resolvedChannelId: snowflakeId.required(),
  resolvedThreadId: optionalSnowflakeId,
  withdrawNoticeChannelId: optionalSnowflakeId,
  incidentChatChannelId: snowflakeId.required(),
  incidentCounter: Joi.number().integer().min(1).required(),

  allowedGuildId: optionalSnowflakeId,
  allowedGuildSource: Joi.string().valid('env', 'config.json', 'none').required(),
  guildAccessMode: Joi.string().valid('locked', 'deny_all').required(),

  googleSheetsEnabled: Joi.boolean().strict().required().messages({
    'boolean.base': 'must be a boolean true/false',
    'any.required': 'is required'
  }),
  googleSheetsSpreadsheetId: Joi.when('googleSheetsEnabled', {
    is: true,
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.alternatives().try(Joi.string().trim().min(1), Joi.valid(null)).default(null)
  }),
  googleSheetsSheetName: Joi.when('googleSheetsEnabled', {
    is: true,
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.alternatives().try(Joi.string().trim().min(1), Joi.valid(null)).default(null)
  }),

  googleServiceAccountJson: Joi.alternatives().try(Joi.string().trim().min(1), Joi.valid(null)).default(null),
  googleServiceAccountB64: Joi.alternatives().try(Joi.string().trim().min(1), Joi.valid(null)).default(null),
  googleServiceAccountFile: Joi.alternatives().try(Joi.string().trim().min(1), Joi.valid(null)).default(null)
})
  .custom((value, helpers) => {
    const normalized = {
      ...value,
      stewardFinalizeChannelId: value.stewardFinalizeChannelId || value.voteChannelId,
      resolvedThreadId: value.resolvedThreadId || value.resolvedChannelId
    };

    if (normalized.googleSheetsEnabled) {
      const hasAnyCredential = Boolean(
        normalized.googleServiceAccountJson ||
          normalized.googleServiceAccountB64 ||
          normalized.googleServiceAccountFile
      );
      if (!hasAnyCredential) {
        return helpers.message(
          'googleSheetsEnabled=true requires one credential env var: GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_B64 or GOOGLE_SERVICE_ACCOUNT_FILE'
        );
      }
    }

    return normalized;
  }, 'cross-field validation')
  .prefs({
    abortEarly: false,
    convert: false,
    allowUnknown: false
  });

module.exports = {
  configSchema,
  DISCORD_SNOWFLAKE_PATTERN
};
