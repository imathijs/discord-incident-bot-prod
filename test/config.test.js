const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, ConfigValidationError } = require('../src/config');

const BASE_FILE_CONFIG = {
  reportChannelId: '1464737830147457200',
  voteChannelId: '1468286260647821475',
  stewardFinalizeChannelId: '1468286260647821475',
  stewardRoleId: '901031862481354812',
  incidentStewardRoleId: '901031862481354812',
  autoDeleteHours: 1,
  resolvedChannelId: '1464737988994011168',
  resolvedThreadId: '1464737988994011168',
  withdrawNoticeChannelId: null,
  incidentChatChannelId: '1466186547601608755',
  allowedGuildId: '662581784617156609',
  incidentCounter: 2026102,
  googleSheetsEnabled: false,
  googleSheetsSpreadsheetId: null,
  googleSheetsSheetName: null
};

async function createTempConfigFile(overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dre-config-'));
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ ...BASE_FILE_CONFIG, ...overrides }, null, 2));
  return { dir, configPath };
}

async function cleanupDir(dir) {
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true });
}

describe('Config loader', () => {
  test('valid config loads successfully', async () => {
    const { dir, configPath } = await createTempConfigFile();
    try {
      const config = loadConfig({
        configPath,
        env: {
          DISCORD_TOKEN: 'test-token',
          ALLOWED_GUILD_ID: '662581784617156609'
        }
      });

      expect(config.discordToken).toBe('test-token');
      expect(config.allowedGuildId).toBe('662581784617156609');
      expect(config.guildAccessMode).toBe('locked');
    } finally {
      await cleanupDir(dir);
    }
  });

  test('missing required key fails fast', async () => {
    const { dir, configPath } = await createTempConfigFile({ voteChannelId: '' });
    try {
      expect(() =>
        loadConfig({
          configPath,
          env: {
            DISCORD_TOKEN: 'test-token',
            ALLOWED_GUILD_ID: '662581784617156609'
          }
        })
      ).toThrow(ConfigValidationError);
    } finally {
      await cleanupDir(dir);
    }
  });

  test('ALLOWED_GUILD_ID not set switches to deny-all mode', async () => {
    const { dir, configPath } = await createTempConfigFile();
    try {
      const config = loadConfig({
        configPath,
        env: {
          DISCORD_TOKEN: 'test-token'
        }
      });

      expect(config.allowedGuildId).toBeNull();
      expect(config.guildAccessMode).toBe('deny_all');
      expect(config.allowedGuildSource).toBe('none');
    } finally {
      await cleanupDir(dir);
    }
  });

  test('empty ALLOWED_GUILD_ID is invalid', async () => {
    const { dir, configPath } = await createTempConfigFile();
    try {
      expect(() =>
        loadConfig({
          configPath,
          env: {
            DISCORD_TOKEN: 'test-token',
            ALLOWED_GUILD_ID: ''
          }
        })
      ).toThrow(ConfigValidationError);
    } finally {
      await cleanupDir(dir);
    }
  });

  test('google sheets settings are validated only when enabled', async () => {
    const { dir, configPath } = await createTempConfigFile({
      googleSheetsEnabled: true,
      googleSheetsSpreadsheetId: 'sheet-id',
      googleSheetsSheetName: 'Sheet1'
    });

    try {
      expect(() =>
        loadConfig({
          configPath,
          env: {
            DISCORD_TOKEN: 'test-token',
            ALLOWED_GUILD_ID: '662581784617156609'
          }
        })
      ).toThrow(ConfigValidationError);
    } finally {
      await cleanupDir(dir);
    }
  });
});
