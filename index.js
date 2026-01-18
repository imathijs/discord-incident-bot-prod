const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  Partials
} = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

try {
  require('dotenv').config();
} catch {}

const config = require('./config.json');
const configPath = path.join(__dirname, 'config.json');
const token = process.env.DISCORD_TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// Opslag voor actieve incidenten
// messageId (stem-post) -> incidentData
const activeIncidents = new Map();
const pendingEvidence = new Map();
const pendingIncidentReports = new Map();
const pendingAppeals = new Map();
const pendingFinalizations = new Map();
const evidenceWindowMs = 5 * 60 * 1000;
const autoDeleteHours = Number(config.autoDeleteHours) || 0;
const autoDeleteMs = autoDeleteHours > 0 ? autoDeleteHours * 60 * 60 * 1000 : 0;
const incidentReportWindowMs = 5 * 60 * 1000;
const appealWindowMs = 5 * 60 * 1000;
const finalizeWindowMs = 5 * 60 * 1000;
const evidenceButtonIds = {
  more: 'evidence_more',
  done: 'evidence_done'
};

function saveConfig() {
  try {
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('Config opslaan mislukt:', err);
  }
}

function generateIncidentNumber() {
  const current = Number(config.incidentCounter) || 2026000;
  const next = current + 1;
  config.incidentCounter = next;
  saveConfig();
  return `INC-${next}`;
}

const incidentReasons = [
  { label: 'Blauwe vlaggen negeren', value: 'blauwe_vlaggen' },
  { label: 'Penalty burnen op de racelijn', value: 'penalty_burnen' },
  { label: 'Niet op de hoogt van omgeving', value: 'niet_op_hoogte' },
  { label: 'Herhaaldelijk de auto aanstoten', value: 'auto_aanstoten' },
  { label: 'Geen ruimte laten', value: 'geen_ruimte' },
  { label: 'De baan onveilig opkomen', value: 'onveilig_opkomen' },
  { label: 'Van de baan rijden', value: 'van_de_baan' },
  { label: 'Kettingbotsing veroorzaken', value: 'kettingbotsing' },
  { label: 'Anders', value: 'anders' }
];

function scheduleMessageDeletion(messageId, channelId) {
  if (!autoDeleteMs) return;
  setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.messages.delete(messageId).catch(() => {});
    } catch {}
  }, autoDeleteMs);
}

function downloadAttachment(url) {
  const https = require('node:https');

  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

function buildEvidencePromptRow(type = 'incident') {
  const doneLabel = type === 'appeal' ? 'Voltooi wederwoord' : 'Voltooi incident';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(evidenceButtonIds.more).setLabel('Meer beelden uploaden').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(evidenceButtonIds.done).setLabel(doneLabel).setStyle(ButtonStyle.Success)
  );
}

client.once('ready', () => {
  console.log(`✅ Bot is online als ${client.user.tag}`);
});

// Slash command registratie
client.on('ready', async () => {
  const commands = [
    {
      name: 'incident-knop',
      description: 'Plaats een knop voor incident meldingen (in het meld-kanaal)',
      default_member_permissions: PermissionFlagsBits.Administrator.toString()
    }
  ];

  await client.application.commands.set(commands);
});

// Helpers
function isSteward(member) {
  return member.roles?.cache?.has(config.stewardRoleId);
}

function buildTallyText(incidentData) {
  const catCount = { cat0: 0, cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 };
  const penaltyPoints = computePenaltyPoints(incidentData);
  for (const v of Object.values(incidentData.votes)) {
    if (v.category && catCount[v.category] !== undefined) catCount[v.category]++;
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

function computePenaltyPoints(incidentData) {
  let penaltyPoints = 0;
  for (const v of Object.values(incidentData.votes)) {
    if (v.plus) penaltyPoints += 1;
    if (v.minus) penaltyPoints -= 1;
  }
  return penaltyPoints;
}

function mostVotedCategory(incidentData) {
  const counts = { cat0: 0, cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 };

  for (const v of Object.values(incidentData.votes)) {
    if (v.category && counts[v.category] !== undefined) counts[v.category]++;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [winner, votes] = sorted[0];
  if (!votes || votes === 0) return null;
  return winner;
}

client.on('interactionCreate', async (interaction) => {
  try {
    // 1) Slash command: knop plaatsen
    if (interaction.isChatInputCommand() && interaction.commandName === 'incident-knop') {
      const reportButton = new ButtonBuilder()
        .setCustomId('report_incident')
        .setLabel('🚨 Meld Incident')
        .setStyle(ButtonStyle.Danger);

      const appealButton = new ButtonBuilder()
        .setCustomId('appeal_incident')
        .setLabel('Wederwoord incident')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(reportButton, appealButton);

      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Race Incident Meldingssysteem')
        .setDescription(
          [
                '**Incident melden bij DRE**',
    '',
    'Wil je een incident melden bij de stewards van DRE?',
    'Klik dan op de knop **Meld Incident**.',
    '',
    'Er wordt automatisch een nieuwe privéchat (DM) gestart',
    'waarin je het incident kunt toelichten.',
    '',
    '⚠️ **Belangrijk**',
    'Zonder bewijsmateriaal kunnen wij een incident niet beoordelen.',
    'Zorg er daarom voor dat je bewijs beschikbaar hebt, zoals:',
    '- een YouTube-video',
    '- losse videobestanden',
    '',
    '❓ **Niet eens met een beslissing?**',
    'Gebruik de knop **Wederwoord incident**',
    'om jouw reactie of bezwaar toe te voegen.',
          ].join('\n')
        );

      await interaction.reply({ embeds: [embed], components: [row] });
      return;
    }

    // 2) Meld-knop: start in DM
    if (interaction.isButton() && interaction.customId === 'report_incident') {
      if (interaction.channelId !== config.reportChannelId) {
        return interaction.reply({
          content: '❌ Incident melden kan alleen in het meld-kanaal.',
          ephemeral: true
        });
      }

      const reasonSelect = new StringSelectMenuBuilder()
        .setCustomId('incident_reason')
        .setPlaceholder('Kies de reden van het incident')
        .addOptions(incidentReasons);

      const reasonRow = new ActionRowBuilder().addComponents(reasonSelect);

      try {
        const dmChannel = await interaction.user.createDM();
        await dmChannel.send({
          content:
            'Vertel hier wat er is gebeurd en doorloop de stappen om het incident in te dienen.\n' +
            'Je kunt een directe YouTube-link toevoegen of je eigen video’s uploaden.\n\n',
          components: [reasonRow]
        });
        await interaction.reply({
          content: '📩 Ik heb je een DM gestuurd om het incident te melden.',
          ephemeral: true
        });
      } catch {
        await interaction.reply({
          content: '❌ Ik kan je geen DM sturen. Zet je DM open en probeer opnieuw.',
          ephemeral: true
        });
      }
      return;
    }

    // 2b) Wederwoord-knop: start in DM
    if (interaction.isButton() && interaction.customId === 'appeal_incident') {
      if (interaction.channelId !== config.reportChannelId) {
        return interaction.reply({
          content: '❌ Wederwoord indienen kan alleen in het meld-kanaal.',
          ephemeral: true
        });
      }

      try {
        const dmChannel = await interaction.user.createDM();
        pendingAppeals.set(interaction.user.id, {
          dmChannelId: dmChannel.id,
          expiresAt: Date.now() + appealWindowMs
        });
        await dmChannel.send({
          content: 'Je kunt hier je wederwoord indienen. Vul het formulier in dat zo verschijnt.'
        });

        const modal = new ModalBuilder()
          .setCustomId('appeal_modal')
          .setTitle('Wederwoord incident');

        const incidentInput = new TextInputBuilder()
          .setCustomId('incident_nummer')
          .setLabel('Incidentnummer (bijv. INC-1234)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const storyInput = new TextInputBuilder()
          .setCustomId('verhaal')
          .setLabel('Jouw verhaal')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const evidenceInput = new TextInputBuilder()
          .setCustomId('bewijs_links')
          .setLabel('Links naar beelden (optioneel)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(incidentInput),
          new ActionRowBuilder().addComponents(storyInput),
          new ActionRowBuilder().addComponents(evidenceInput)
        );

        await interaction.showModal(modal);
      } catch {
        return interaction.reply({
          content: '❌ Ik kan je geen DM sturen. Zet je DM open en probeer opnieuw.',
          ephemeral: true
        });
      }
      return;
    }

    // 3) Dropdown submit: reden bewaren en modal tonen
    if (interaction.isStringSelectMenu() && interaction.customId === 'incident_reason') {
      if (interaction.guildId) {
        return interaction.reply({ content: '❌ Meld een incident via de DM die je kreeg.', ephemeral: true });
      }

      pendingIncidentReports.set(interaction.user.id, {
        reasonValue: interaction.values[0],
        reporterTag: interaction.user.tag,
        reportChannelId: interaction.channelId,
        expiresAt: Date.now() + incidentReportWindowMs
      });

      const modal = new ModalBuilder()
        .setCustomId('incident_modal')
        .setTitle('Race Incident Melding');

      const raceInput = new TextInputBuilder()
        .setCustomId('race_naam')
        .setLabel('Welke race?')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const roundInput = new TextInputBuilder()
        .setCustomId('ronde')
        .setLabel('Welke ronde?')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const driverInput = new TextInputBuilder()
        .setCustomId('schuldige_rijder')
        .setLabel('Schuldige rijder (naam)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('beschrijving')
        .setLabel('Beschrijving van het incident')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const evidenceInput = new TextInputBuilder()
        .setCustomId('bewijs_links')
        .setLabel('Links naar beelden (video/plaatjes)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Streamable, YouTube, Imgur, etc.')
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(raceInput),
        new ActionRowBuilder().addComponents(roundInput),
        new ActionRowBuilder().addComponents(driverInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(evidenceInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // 4) Modal submit: post naar voteChannel
    if (interaction.isModalSubmit() && interaction.customId === 'incident_modal') {
      const pending = pendingIncidentReports.get(interaction.user.id);
      if (!pending) {
        return interaction.reply({ content: '❌ Geen open incident gevonden. Meld opnieuw.', ephemeral: true });
      }
      if (Date.now() > pending.expiresAt) {
        pendingIncidentReports.delete(interaction.user.id);
        return interaction.reply({ content: '❌ Tijd verlopen. Meld opnieuw.', ephemeral: true });
      }

      const raceName = interaction.fields.getTextInputValue('race_naam');
      const round = interaction.fields.getTextInputValue('ronde');
      const guiltyDriver = interaction.fields.getTextInputValue('schuldige_rijder');
      const description = interaction.fields.getTextInputValue('beschrijving');
      const evidence = interaction.fields.getTextInputValue('bewijs_links') || 'Geen bewijs geüpload';

      const voteChannel = await client.channels.fetch(config.voteChannelId).catch(() => null);
      if (!voteChannel) {
        return interaction.reply({ content: '❌ Stem-kanaal niet gevonden! Check voteChannelId.', ephemeral: true });
      }

      const reasonValue = pending.reasonValue;
      const reasonLabel = incidentReasons.find((r) => r.value === reasonValue)?.label || reasonValue;
      const incidentNumber = generateIncidentNumber();

      const incidentEmbed = new EmbedBuilder()
        .setColor('#FF6B00')
        .setTitle(`🚨 Incident ${incidentNumber} - ${raceName}`)
        .addFields(
          { name: '🔢 Incidentnummer', value: incidentNumber, inline: true },
          { name: '👤 Ingediend door', value: `${pending.reporterTag}`, inline: true },
          { name: '🏁 Race', value: raceName, inline: true },
          { name: '🔢 Ronde', value: round, inline: true },
          { name: '⚠️ Schuldige rijder', value: guiltyDriver, inline: true },
          { name: '📌 Reden', value: reasonLabel },
          { name: '📝 Beschrijving', value: description },
          { name: '🎥 Bewijs', value: evidence },
          { name: '📊 Tussenstand', value: 'Nog geen stemmen.' }
        )
        .setTimestamp();

      const voteButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vote_cat0').setLabel('Cat 0').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vote_cat1').setLabel('Cat 1').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vote_cat2').setLabel('Cat 2').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vote_cat3').setLabel('Cat 3').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vote_cat4').setLabel('Cat 4').setStyle(ButtonStyle.Secondary)
      );

      const voteButtonsRow2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vote_cat5').setLabel('Cat 5').setStyle(ButtonStyle.Secondary)
      );

      const extraButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vote_plus').setLabel('+ Strafpunt').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('vote_minus').setLabel('- Strafpunt').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('finalize_votes').setLabel('✅ Afsluiten').setStyle(ButtonStyle.Danger)
      );

      const message = await voteChannel.send({
        content: `<@&${config.stewardRoleId}> - Incident ${incidentNumber} gemeld - ${raceName} (${round}) - Door ${pending.reporterTag}`,
        embeds: [incidentEmbed],
        components: [voteButtons, voteButtonsRow2, extraButtons]
      });

      activeIncidents.set(message.id, {
        votes: {}, // userId -> { category: 'cat3', plus: bool, minus: bool }
        incidentNumber,
        raceName,
        round,
        guiltyDriver,
        reason: reasonLabel,
        reporter: pending.reporterTag
      });

      pendingEvidence.set(interaction.user.id, {
        messageId: message.id,
        channelId: pending.reportChannelId,
        expiresAt: Date.now() + evidenceWindowMs,
        type: 'incident'
      });

      pendingIncidentReports.delete(interaction.user.id);
      await interaction.reply({
        content:
          '✅ Je incident is verzonden naar de stewards!\n' +
          `Incidentnummer: **${incidentNumber}**\n` +
          'Upload je bewijsmateriaal in dit kanaal binnen 5 minuten om het automatisch toe te voegen.',
        ephemeral: true
      });
      return;
    }

    // 4b) Modal submit: wederwoord naar stewards
    if (interaction.isModalSubmit() && interaction.customId === 'appeal_modal') {
      const pending = pendingAppeals.get(interaction.user.id);
      if (!pending) {
        return interaction.reply({ content: '❌ Geen open wederwoord gevonden. Klik opnieuw op de knop.', ephemeral: true });
      }
      if (Date.now() > pending.expiresAt) {
        pendingAppeals.delete(interaction.user.id);
        return interaction.reply({ content: '❌ Tijd verlopen. Klik opnieuw op de knop.', ephemeral: true });
      }

      const incidentNumber = interaction.fields.getTextInputValue('incident_nummer').trim();
      const story = interaction.fields.getTextInputValue('verhaal');
      const evidenceLinks = interaction.fields.getTextInputValue('bewijs_links') || 'Geen bewijs geüpload';

      const voteChannel = await client.channels.fetch(config.voteChannelId).catch(() => null);
      if (!voteChannel) {
        return interaction.reply({ content: '❌ Steward-kanaal niet gevonden! Check voteChannelId.', ephemeral: true });
      }

      const appealEmbed = new EmbedBuilder()
        .setColor('#1E90FF')
        .setTitle(`🗣️ Wederwoord - ${incidentNumber}`)
        .addFields(
          { name: '🔢 Incidentnummer', value: incidentNumber, inline: true },
          { name: '👤 Ingediend door', value: interaction.user.tag, inline: true },
          { name: '📝 Verhaal', value: story },
          { name: '🎥 Bewijs', value: evidenceLinks }
        )
        .setTimestamp();

      const appealMessage = await voteChannel.send({
        content: `<@&${config.stewardRoleId}> - Wederwoord ontvangen voor incident ${incidentNumber}`,
        embeds: [appealEmbed]
      });

      pendingEvidence.set(interaction.user.id, {
        messageId: appealMessage.id,
        channelId: pending.dmChannelId,
        expiresAt: Date.now() + evidenceWindowMs,
        type: 'appeal',
        incidentNumber
      });

      pendingAppeals.delete(interaction.user.id);

      try {
        const dmChannel = await interaction.user.createDM();
        await dmChannel.send(
          '✅ Je wederwoord is doorgestuurd naar de stewards.\n' +
            'Upload je bewijsmateriaal in dit kanaal binnen 5 minuten om het automatisch toe te voegen.'
        );
      } catch {}

      return interaction.reply({
        content: '✅ Wederwoord ontvangen! Check je DM voor eventuele beelden.',
        ephemeral: true
      });
    }

    // 4) Bewijs-buttons in meld-kanaal
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === evidenceButtonIds.more || id === evidenceButtonIds.done) {
        const pending = pendingEvidence.get(interaction.user.id);
        const pendingType = pending?.type || 'incident';
        if (!pending) {
          return interaction.reply({
            content: '❌ Geen open bewijs-upload gevonden.',
            ephemeral: true
          });
        }
        if (pending.channelId !== interaction.channelId) {
          return interaction.reply({
            content: '❌ Bewijs uploaden kan alleen in het juiste kanaal.',
            ephemeral: true
          });
        }

        if (Date.now() > pending.expiresAt) {
          pendingEvidence.delete(interaction.user.id);
          return interaction.reply({
            content: '❌ Tijd verlopen. Start de melding opnieuw.',
            ephemeral: true
          });
        }

        if (id === evidenceButtonIds.more) {
          pending.expiresAt = Date.now() + evidenceWindowMs;
          pending.promptMessageId = null;
          pendingEvidence.set(interaction.user.id, pending);
          if (interaction.message.deletable) {
            await interaction.message.delete().catch(() => {});
          }
          return interaction.reply({
            content:
              pendingType === 'appeal'
                ? '✅ Je kunt extra beelden uploaden voor je wederwoord. Upload binnen 5 minuten.'
                : '✅ Je kunt extra beelden uploaden. Upload binnen 5 minuten.',
            ephemeral: true
          });
        }

        pendingEvidence.delete(interaction.user.id);
        if (interaction.message.deletable) {
          await interaction.message.delete().catch(() => {});
        }
        return interaction.reply({
          content:
            pendingType === 'appeal'
              ? '✅ Wederwoord afgerond. Bedankt voor het bewijs.'
              : '✅ Incident afgerond. Bedankt voor het bewijs.',
          ephemeral: true
        });
      }

      // 5) Stemmen / toggles / afsluiten
      const incidentData = activeIncidents.get(interaction.message.id);
      const isVoteMessage = !!incidentData;

      // Laat andere knoppen met rust
      if (!isVoteMessage) return;

      // Stemmen alleen in voteChannel
      if (interaction.channelId !== config.voteChannelId) {
        return interaction.reply({ content: '❌ Stemmen kan alleen in het stem-kanaal.', ephemeral: true });
      }

      // Alleen stewards
      if (!isSteward(interaction.member)) {
        return interaction.reply({ content: '❌ Alleen stewards kunnen stemmen!', ephemeral: true });
      }

      // Zorg dat gebruiker entry heeft
      if (!incidentData.votes[interaction.user.id]) {
        incidentData.votes[interaction.user.id] = { category: null, plus: false, minus: false };
      }

      // Afsluiten
      if (id === 'finalize_votes') {
        pendingFinalizations.set(interaction.user.id, {
          messageId: interaction.message.id,
          channelId: interaction.channelId,
          expiresAt: Date.now() + finalizeWindowMs
        });

        const modal = new ModalBuilder()
          .setCustomId('finalize_modal')
          .setTitle('Eindoordeel toevoegen');

        const decisionInput = new TextInputBuilder()
          .setCustomId('eindoordeel')
          .setLabel('Eindoordeel (vrije tekst)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(decisionInput));

        await interaction.showModal(modal);
        return;
      }

      // Categorie stemmen
      if (id.startsWith('vote_cat')) {
        const cat = id.replace('vote_', ''); // "cat0".."cat5"
        incidentData.votes[interaction.user.id].category = cat;

        // Update tussenstand in embed
        const tally = buildTallyText(incidentData);
        const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
        const fields = newEmbed.data.fields ?? [];
        const idx = fields.findIndex(f => f.name === '📊 Tussenstand');
        if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
        newEmbed.setFields(fields);

        await interaction.message.edit({ embeds: [newEmbed] });
        return interaction.reply({ content: `✅ Stem geregistreerd: **${cat.toUpperCase()}**`, ephemeral: true });
      }

      // + Strafpunt toggle (aan/uit)
      if (id === 'vote_plus') {
        const entry = incidentData.votes[interaction.user.id];
        entry.plus = !entry.plus;

        // Optioneel: voorkom dat plus & minus tegelijk aan staan
        if (entry.plus) entry.minus = false;

        const tally = buildTallyText(incidentData);
        const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
        const fields = newEmbed.data.fields ?? [];
        const idx = fields.findIndex(f => f.name === '📊 Tussenstand');
        if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
        newEmbed.setFields(fields);

        await interaction.message.edit({ embeds: [newEmbed] });
        return interaction.reply({
          content: `✅ + Strafpunt is nu **${entry.plus ? 'AAN' : 'UIT'}** (voor jouw stem)`,
          ephemeral: true
        });
      }

      // - Strafpunt toggle (aan/uit)
      if (id === 'vote_minus') {
        const entry = incidentData.votes[interaction.user.id];
        entry.minus = !entry.minus;

        // Optioneel: voorkom dat plus & minus tegelijk aan staan
        if (entry.minus) entry.plus = false;

        const tally = buildTallyText(incidentData);
        const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
        const fields = newEmbed.data.fields ?? [];
        const idx = fields.findIndex(f => f.name === '📊 Tussenstand');
        if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
        newEmbed.setFields(fields);

        await interaction.message.edit({ embeds: [newEmbed] });
        return interaction.reply({
          content: `✅ - Strafpunt is nu **${entry.minus ? 'AAN' : 'UIT'}** (voor jouw stem)`,
          ephemeral: true
        });
      }
    }

    // 6) Finalize modal submit: posten in stem- en afgehandeld-kanaal
    if (interaction.isModalSubmit() && interaction.customId === 'finalize_modal') {
      const pending = pendingFinalizations.get(interaction.user.id);
      if (!pending) {
        return interaction.reply({ content: '❌ Geen open afsluiting gevonden.', ephemeral: true });
      }
      if (Date.now() > pending.expiresAt) {
        pendingFinalizations.delete(interaction.user.id);
        return interaction.reply({ content: '❌ Tijd verlopen. Probeer opnieuw.', ephemeral: true });
      }

      const incidentData = activeIncidents.get(pending.messageId);
      if (!incidentData) {
        pendingFinalizations.delete(interaction.user.id);
        return interaction.reply({ content: '❌ Incident niet gevonden of al afgehandeld.', ephemeral: true });
      }

      if (!isSteward(interaction.member)) {
        pendingFinalizations.delete(interaction.user.id);
        return interaction.reply({ content: '❌ Alleen stewards kunnen afsluiten!', ephemeral: true });
      }

      const voteChannel = await client.channels.fetch(config.voteChannelId).catch(() => null);
      if (!voteChannel) {
        return interaction.reply({ content: '❌ Stem-kanaal niet gevonden! Check voteChannelId.', ephemeral: true });
      }

      const voteMessage = await voteChannel.messages.fetch(pending.messageId).catch(() => null);
      if (!voteMessage) {
        pendingFinalizations.delete(interaction.user.id);
        return interaction.reply({ content: '❌ Stem-bericht niet gevonden.', ephemeral: true });
      }

      const tally = buildTallyText(incidentData);
      const winner = mostVotedCategory(incidentData);
      const decision = winner ? winner.toUpperCase() : 'CAT0';
      const penaltyPoints = computePenaltyPoints(incidentData);
      let finalText = interaction.fields.getTextInputValue('eindoordeel').trim();
      if (decision === 'CAT0') finalText = 'No futher action';

      const resultEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Steward Besluit')
        .setDescription(`👤 Ingediend door: ${incidentData.reporter || 'Onbekend'}`)
        .addFields(
          { name: '🔢 Incidentnummer', value: incidentData.incidentNumber || 'Onbekend', inline: true },
          { name: '🏁 Race', value: incidentData.raceName, inline: true },
          { name: '⚠️ Rijder', value: incidentData.guiltyDriver, inline: true },
          { name: '📊 Stemresultaat', value: `\`\`\`\n${tally}\n\`\`\`` },
          { name: '⚖️ Eindoordeel', value: `**${decision}**`, inline: true },
          { name: '🎯 Strafpunten', value: `**${penaltyPoints}**`, inline: true },
          { name: '📝 Toelichting', value: finalText }
        )
        .setTimestamp();

      await voteMessage.edit({ components: [] });
      await voteMessage.reply({ embeds: [resultEmbed] });

      const resolvedChannel = await client.channels.fetch(config.resolvedChannelId).catch(() => null);
      if (resolvedChannel) {
        const reportEmbed = new EmbedBuilder()
          .setColor('#2ECC71')
          .setTitle(`📄 Incident Afgehandeld - ${incidentData.incidentNumber || 'Onbekend'}`)
          .setDescription('Uitslag van het stewardsoverleg.')
          .addFields(
            { name: '🔢 Incidentnummer', value: incidentData.incidentNumber || 'Onbekend', inline: true },
            { name: '🏁 Race', value: incidentData.raceName, inline: true },
            { name: '🔢 Ronde', value: incidentData.round, inline: true },
            { name: '👤 Ingediend door', value: incidentData.reporter || 'Onbekend', inline: true },
            { name: '⚠️ Rijder', value: incidentData.guiltyDriver, inline: true },
            { name: '📌 Reden', value: incidentData.reason || 'Onbekend' },
            { name: '⚖️ Eindoordeel', value: `**${decision}**`, inline: true },
            { name: '🎯 Strafpunten', value: `**${penaltyPoints}**`, inline: true },
            { name: '📝 Toelichting', value: finalText },
            {
              name: '🗣️ Wederwoord',
              value: 'Niet eens met het besluit?\nVerstuur dan een DM via Race Incident Bot met vermelding onder het incident nummer.\n"INC-<nummer> - je verhaal.."'
            }
          )
          .setTimestamp();
        await resolvedChannel.send({ embeds: [reportEmbed] });
      }

      activeIncidents.delete(pending.messageId);
      pendingFinalizations.delete(interaction.user.id);
      return interaction.reply({ content: '✅ Incident afgehandeld!', ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: '❌ Er ging iets mis. Check de bot logs.', ephemeral: true });
      } catch {}
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.attachments.size === 0) return;

  const pending = pendingEvidence.get(message.author.id);
  if (!pending) return;
  const pendingType = pending.type || 'incident';
  if (pending.channelId !== message.channelId) return;
  if (Date.now() > pending.expiresAt) {
    pendingEvidence.delete(message.author.id);
    return;
  }

  const voteChannel = await client.channels.fetch(config.voteChannelId).catch(() => null);
  if (!voteChannel) return;

  const voteMessage = await voteChannel.messages.fetch(pending.messageId).catch(() => null);
  if (!voteMessage) return;

  const attachmentLinks = [...message.attachments.values()].map(a => a.url).join('\n');
  const embed = EmbedBuilder.from(voteMessage.embeds[0]);
  const fields = embed.data.fields ?? [];
  const idx = fields.findIndex(f => f.name === '🎥 Bewijs');
  if (idx >= 0) {
    const existing = fields[idx].value?.trim() || '';
    const hasPlaceholder = existing === 'Geen bewijs geüpload';
    fields[idx].value = hasPlaceholder ? attachmentLinks : `${existing}\n${attachmentLinks}`;
  }
  embed.setFields(fields);

  await voteMessage.edit({ embeds: [embed] });
  try {
    const attachments = [...message.attachments.values()];
    const files = [];
    for (const a of attachments) {
      const buffer = await downloadAttachment(a.url);
      files.push({ attachment: buffer, name: a.name || 'bewijs' });
    }
    if (files.length > 0) {
      const incidentData = activeIncidents.get(pending.messageId);
      const raceLabel =
        pendingType === 'appeal'
          ? `Incident ${pending.incidentNumber || 'Onbekend'}`
          : incidentData
            ? `${incidentData.incidentNumber} - ${incidentData.raceName} (${incidentData.round})`
            : 'Onbekend incident';
      await voteChannel.send({
        content:
          pendingType === 'appeal'
            ? `📎 Bewijsmateriaal wederwoord van ${message.author.tag} - ${raceLabel}`
            : `📎 Bewijsmateriaal van ${message.author.tag} - ${raceLabel}`,
        files
      });
    }
  } catch (err) {
    console.error('Bewijs uploaden mislukt:', err);
  }
  const confirmation = await message.reply('✅ Bewijsmateriaal toegevoegd aan de steward-melding.');
  if (pending.promptMessageId) {
    const oldPrompt = await message.channel.messages.fetch(pending.promptMessageId).catch(() => null);
    if (oldPrompt?.deletable) await oldPrompt.delete().catch(() => {});
  }
  const prompt = await message.reply({
    content: 'Wil je nog meer beelden uploaden?',
    components: [buildEvidencePromptRow(pendingType)]
  });
  scheduleMessageDeletion(message.id, message.channelId);
  scheduleMessageDeletion(confirmation.id, confirmation.channelId);
  scheduleMessageDeletion(prompt.id, prompt.channelId);
  if (prompt?.id) {
    pendingEvidence.set(message.author.id, {
      ...pending,
      expiresAt: Date.now() + evidenceWindowMs,
      promptMessageId: prompt.id
    });
  } else {
    pendingEvidence.set(message.author.id, {
      ...pending,
      expiresAt: Date.now() + evidenceWindowMs
    });
  }
});

if (!token) {
  console.error('DISCORD_TOKEN ontbreekt. Zet deze als environment variable en start opnieuw.');
  process.exit(1);
}

client.login(token);
