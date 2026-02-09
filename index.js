const { Client, GatewayIntentBits, Partials } = require('discord.js');

function assertRuntimeRequirements() {
  const [major, minor] = process.versions.node.split('.').map((v) => Number(v));
  const minMajor = 16;
  const minMinor = 9;
  const isNodeOk = major > minMajor || (major === minMajor && minor >= minMinor);
  if (!isNodeOk) {
    console.error(
      `Node.js versie te oud (${process.versions.node}). Vereist >= ${minMajor}.${minMinor}.`
    );
    process.exit(1);
  }

  let discordMajor = null;
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    const pkg = require('discord.js/package.json');
    discordMajor = Number(String(pkg.version || '').split('.')[0]) || null;
  } catch {}
  if (discordMajor && discordMajor < 14) {
    console.error(`discord.js versie te oud (${discordMajor}). Vereist v14+.`);
    process.exit(1);
  }
}

try {
  require('dotenv').config();
} catch {}

const { config, token } = require('./src/config');
const { createState } = require('./src/state');
const { registerInteractionHandlers } = require('./src/infrastructure/discord/interaction');
const { registerMessageHandlers } = require('./src/infrastructure/discord/message');

assertRuntimeRequirements();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const state = createState(config);
const generateIncidentNumber = () => state.store.nextIncidentNumber();

state.store.cleanupExpiredPending().catch((err) => {
  console.error('Pending state cleanup failed:', err?.message || err);
});

registerInteractionHandlers(client, { config, state, generateIncidentNumber });
registerMessageHandlers(client, { config, state });

client.on('clientReady', async () => {
  if (!config.allowedGuildId) return;
  const otherGuilds = client.guilds.cache.filter((g) => g.id !== config.allowedGuildId);
  for (const guild of otherGuilds.values()) {
    await guild.leave().catch(() => {});
  }
});

client.on('guildCreate', async (guild) => {
  if (!config.allowedGuildId) return;
  if (guild.id === config.allowedGuildId) return;
  await guild.leave().catch(() => {});
});

if (!token) {
  console.error('DISCORD_TOKEN ontbreekt. Zet deze als environment variable en start opnieuw.');
  process.exit(1);
}

client.login(token);
