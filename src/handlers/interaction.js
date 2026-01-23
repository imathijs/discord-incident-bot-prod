const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} = require('discord.js');
const {
  incidentReasons,
  evidenceButtonIds,
  evidenceWindowMs,
  incidentReportWindowMs,
  appealWindowMs,
  finalizeWindowMs
} = require('../constants');
const { buildTallyText, computePenaltyPoints, mostVotedCategory } = require('../utils/votes');
const { buildEvidencePromptRow } = require('../utils/evidence');

function registerInteractionHandlers(client, { config, state, generateIncidentNumber }) {
  const { activeIncidents, pendingEvidence, pendingIncidentReports, pendingAppeals, pendingFinalizations } = state;

  function isSteward(member) {
    return member.roles?.cache?.has(config.stewardRoleId);
  }

  const buildIncidentModal = ({ raceName, round, description } = {}) => {
    const modal = new ModalBuilder().setCustomId('incident_modal').setTitle('Race Incident Melding');

    const raceInput = new TextInputBuilder()
      .setCustomId('race_naam')
      .setLabel('Welke race?')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    if (raceName != null) raceInput.setValue(raceName);

    const roundInput = new TextInputBuilder()
      .setCustomId('ronde')
      .setLabel('Welke ronde?')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    if (round != null) roundInput.setValue(round);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('beschrijving')
      .setLabel('Beschrijving van het incident')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    if (description != null) descriptionInput.setValue(description);

    modal.addComponents(
      new ActionRowBuilder().addComponents(raceInput),
      new ActionRowBuilder().addComponents(roundInput),
      new ActionRowBuilder().addComponents(descriptionInput)
    );

    return modal;
  };

  const buildIncidentReviewEmbed = ({
    incidentNumber,
    raceName,
    round,
    description,
    reasonLabel,
    guiltyMention,
    reporterTag
  }) =>
    new EmbedBuilder()
      .setColor('#FFA000')
      .setTitle(`✅ Controleer je incidentmelding - ${incidentNumber || 'Onbekend'}`)
      .setDescription('Controleer je gegevens. Kies **Bewerken** om aan te passen of **Bevestigen** om te verzenden.')
      .addFields(
        { name: '🔢 Incidentnummer', value: incidentNumber || 'Onbekend', inline: true },
        { name: '👤 Ingediend door', value: reporterTag || 'Onbekend', inline: true },
        { name: '⚠️ Schuldige rijder', value: guiltyMention || 'Onbekend', inline: true },
        { name: '📌 Reden', value: reasonLabel || 'Onbekend', inline: false },
        { name: '🏁 Race', value: raceName || 'Onbekend', inline: true },
        { name: '🔢 Ronde', value: round || 'Onbekend', inline: true },
        { name: '📝 Beschrijving', value: description || 'Onbekend', inline: false }
      );

  const submitIncidentReport = async (interaction, pending) => {
    const raceName = pending.raceName;
    const round = pending.round;
    const description = pending.description;
    const evidence = 'Zie uploads';

    if (!raceName || !round || !description) {
      return interaction.editReply({
        content: '❌ Je melding mist gegevens. Klik op **Bewerken** en vul alles opnieuw in.'
      });
    }

    const voteChannel = await client.channels.fetch(config.voteChannelId).catch(() => null);
    if (!voteChannel) {
      return interaction.editReply({ content: '❌ Stem-kanaal niet gevonden! Check voteChannelId.' });
    }

    const reasonValue = pending.reasonValue;
    const reasonLabel = incidentReasons.find((r) => r.value === reasonValue)?.label || reasonValue;
    const incidentNumber = pending.incidentNumber || generateIncidentNumber();

    const guiltyDriver = pending.guiltyTag || 'Onbekend';
    const guiltyMention = pending.guiltyId ? `<@${pending.guiltyId}>` : guiltyDriver;

    const maxLabelNameLength = 24;
    const truncateLabelName = (value) => {
      if (!value) return 'Onbekend';
      return value.length > maxLabelNameLength ? `${value.slice(0, maxLabelNameLength - 1)}…` : value;
    };
    const guiltyLabelName = truncateLabelName(guiltyDriver);
    const reporterLabelName = truncateLabelName(pending.reporterTag);

    const incidentEmbed = new EmbedBuilder()
      .setColor('#FF6B00')
      .setTitle(`🚨 Incident ${incidentNumber} - ${raceName}`)
      .addFields(
        { name: '🔢 Incidentnummer', value: incidentNumber, inline: true },
        { name: '👤 Ingediend door', value: `${pending.reporterTag}`, inline: true },
        { name: '🏁 Race', value: raceName, inline: true },
        { name: '🔢 Ronde', value: round, inline: true },
        { name: '⚠️ Schuldige rijder', value: guiltyMention || guiltyDriver, inline: true },
        { name: '📌 Reden', value: reasonLabel },
        { name: '📝 Beschrijving', value: description },
        { name: '🎥 Bewijs', value: evidence },
        { name: '📊 Tussenstand (Dader)', value: 'Nog geen stemmen.' },
        { name: '📊 Tussenstand (Indiener)', value: 'Nog geen stemmen.' }
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
      new ButtonBuilder().setCustomId('vote_cat5').setLabel('Cat 5').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vote_plus').setLabel('+ Strafpunt').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vote_minus').setLabel('- Strafpunt').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('finalize_votes').setLabel('✅ Incident afhandelen').setStyle(ButtonStyle.Danger)
    );

    const reporterSelect = new StringSelectMenuBuilder()
      .setCustomId('vote_reporter_select')
      .setPlaceholder(`Indiener: ${reporterLabelName}`)
      .addOptions(
        { label: 'Cat 0', value: 'cat0' },
        { label: 'Cat 1', value: 'cat1' },
        { label: 'Cat 2', value: 'cat2' },
        { label: 'Cat 3', value: 'cat3' },
        { label: 'Cat 4', value: 'cat4' },
        { label: 'Cat 5', value: 'cat5' },
        { label: '+ Strafpunt', value: 'plus' },
        { label: '- Strafpunt', value: 'minus' }
      );

    const reporterSelectRow = new ActionRowBuilder().addComponents(reporterSelect);

    const guiltySeparatorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sep_schuldige')
        .setLabel(`──────── ${guiltyLabelName} ────────`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    const reporterSeparatorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sep_indiener')
        .setLabel(`──────── ${reporterLabelName} ────────`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    const message = await voteChannel.send({
      content: `<@&${config.stewardRoleId}> - Incident ${incidentNumber} gemeld - ${raceName} (${round}) - Door ${pending.reporterTag}`,
      embeds: [incidentEmbed],
      components: [guiltySeparatorRow, voteButtons, voteButtonsRow2, reporterSeparatorRow, reporterSelectRow]
    });

    activeIncidents.set(message.id, {
      votes: {},
      incidentNumber,
      raceName,
      round,
      guiltyDriver,
      reason: reasonLabel,
      reporter: pending.reporterTag
    });

    let evidenceChannelId = interaction.channelId;
    let evidenceLocation = 'dit kanaal';
    try {
      const dmChannel = await interaction.user.createDM();
      evidenceChannelId = dmChannel.id;
      evidenceLocation = 'je DM';
      await dmChannel.send(
        '✅ Je incident is verzonden naar de stewards.\n' +
          `Incidentnummer: **${incidentNumber}**\n` +
          `Upload je bewijsmateriaal voor **${incidentNumber}** in dit kanaal binnen 5 minuten om het automatisch toe te voegen.`
      );
    } catch {}

    pendingEvidence.set(interaction.user.id, {
      messageId: message.id,
      channelId: evidenceChannelId,
      expiresAt: Date.now() + evidenceWindowMs,
      type: 'incident',
      incidentNumber
    });

    pendingIncidentReports.delete(interaction.user.id);
    await interaction.editReply({
      content:
        '✅ Je incident is verzonden naar de stewards!\n' +
        `Incidentnummer: **${incidentNumber}**\n` +
        `Upload je bewijsmateriaal voor **${incidentNumber}** in ${evidenceLocation} binnen 5 minuten om het automatisch toe te voegen.`
    });
  };

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
              'Je doorloopt de stappen in dit kanaal.',
              'Na het indienen ontvang je een DM voor bewijsmateriaal.',
              '',
              '⚠️ **Belangrijk**',
              'Zonder bewijsmateriaal kunnen wij een incident niet beoordelen.',
              'Zorg er daarom voor dat je bewijs beschikbaar hebt, zoals:',
              '- een YouTube-video',
              '- losse videobestanden',
              '',
              '❓ **Niet eens met een beslissing?**',
              'Gebruik de knop **Wederwoord incident**',
              'om jouw reactie of bezwaar toe te voegen.'
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

        await interaction.reply({
          content: 'Kies de reden van het incident. Daarna kun je de schuldige selecteren.',
          components: [reasonRow],
          ephemeral: true
        });
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

      // 3) Dropdown submit: reden bewaren en vraag om schuldige (User Select)
      if (interaction.isStringSelectMenu() && interaction.customId === 'incident_reason') {
        if (!interaction.guildId) {
          return interaction.reply({ content: '❌ Meld een incident via het meld-kanaal.', ephemeral: true });
        }

        pendingIncidentReports.set(interaction.user.id, {
          reasonValue: interaction.values[0],
          reporterTag: interaction.user.tag,
          reporterId: interaction.user.id,
          guildId: interaction.guildId,
          expiresAt: Date.now() + incidentReportWindowMs
        });

        const userSelect = new UserSelectMenuBuilder()
          .setCustomId('incident_culprit_select')
          .setPlaceholder('Selecteer de schuldige rijder')
          .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(userSelect);

        await interaction.reply({
          content: 'Wie is de tegenpartij/schuldige?',
          components: [row],
          ephemeral: true
        });
        return;
      }

      // 3a) User Select submit: schuldige bewaren en modal tonen
      if (interaction.isUserSelectMenu() && interaction.customId === 'incident_culprit_select') {
        const pending = pendingIncidentReports.get(interaction.user.id);
        if (!pending) {
          return interaction.reply({ content: '❌ Sessie verlopen. Begin opnieuw.', ephemeral: true });
        }

        const selectedUserId = interaction.values[0];
        const selectedUser = interaction.users.get(selectedUserId);
        pending.guiltyId = selectedUserId;
        pending.guiltyTag = selectedUser ? selectedUser.tag : 'Onbekend';
        
        // Update pending state
        pendingIncidentReports.set(interaction.user.id, pending);

        await interaction.showModal(buildIncidentModal());
        return;
      }

      // 3b) Dropdown stemmen voor indiener
      if (interaction.isStringSelectMenu() && interaction.customId === 'vote_reporter_select') {
        const incidentData = activeIncidents.get(interaction.message.id);
        const isVoteMessage = !!incidentData;

        if (!isVoteMessage) return;
        if (interaction.channelId !== config.voteChannelId) {
          return interaction.reply({ content: '❌ Stemmen kan alleen in het stem-kanaal.', ephemeral: true });
        }
        if (!isSteward(interaction.member)) {
          return interaction.reply({ content: '❌ Alleen stewards kunnen stemmen!', ephemeral: true });
        }

        if (!incidentData.votes[interaction.user.id]) {
          incidentData.votes[interaction.user.id] = {
            category: null,
            plus: false,
            minus: false,
            reporterCategory: null,
            reporterPlus: false,
            reporterMinus: false
          };
        }

        const value = interaction.values[0];
        const entry = incidentData.votes[interaction.user.id];

        if (value === 'plus') {
          entry.reporterPlus = !entry.reporterPlus;
          if (entry.reporterPlus) entry.reporterMinus = false;
        } else if (value === 'minus') {
          entry.reporterMinus = !entry.reporterMinus;
          if (entry.reporterMinus) entry.reporterPlus = false;
        } else {
          entry.reporterCategory = value;
        }

        const tally = buildTallyText(incidentData.votes, 'reporter');
        const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
        const fields = newEmbed.data.fields ?? [];
        const idx = fields.findIndex((f) => f.name === '📊 Tussenstand (Indiener)');
        if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
        newEmbed.setFields(fields);

        await interaction.message.edit({ embeds: [newEmbed] });

        if (value === 'plus' || value === 'minus') {
          return interaction.reply({
            content: `✅ ${value === 'plus' ? '+ Strafpunt' : '- Strafpunt'} is nu **${value === 'plus' ? (entry.reporterPlus ? 'AAN' : 'UIT') : (entry.reporterMinus ? 'AAN' : 'UIT')}** (indiener)`,
            ephemeral: true
          });
        }

        return interaction.reply({ content: `✅ Stem geregistreerd: **${value.toUpperCase()}** (indiener)`, ephemeral: true });
      }

      // 4) Modal submit: review tonen
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
        const description = interaction.fields.getTextInputValue('beschrijving');
        pending.raceName = raceName;
        pending.round = round;
        pending.description = description;
        if (!pending.incidentNumber) pending.incidentNumber = generateIncidentNumber();
        pending.expiresAt = Date.now() + incidentReportWindowMs;
        pendingIncidentReports.set(interaction.user.id, pending);

        const reasonValue = pending.reasonValue;
        const reasonLabel = incidentReasons.find((r) => r.value === reasonValue)?.label || reasonValue;
        const guiltyDriver = pending.guiltyTag || 'Onbekend';
        const guiltyMention = pending.guiltyId ? `<@${pending.guiltyId}>` : guiltyDriver;

        const reviewEmbed = buildIncidentReviewEmbed({
          incidentNumber: pending.incidentNumber,
          raceName,
          round,
          description,
          reasonLabel,
          guiltyMention,
          reporterTag: pending.reporterTag
        });

        const reviewButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('incident_review_edit').setLabel('✏️ Bewerken').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('incident_review_confirm').setLabel('✅ Bevestigen').setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ embeds: [reviewEmbed], components: [reviewButtons], ephemeral: true });
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

        if (id === 'incident_review_edit' || id === 'incident_review_confirm') {
          const pending = pendingIncidentReports.get(interaction.user.id);
          if (!pending) {
            return interaction.reply({ content: '❌ Geen open incident gevonden. Meld opnieuw.', ephemeral: true });
          }
          if (Date.now() > pending.expiresAt) {
            pendingIncidentReports.delete(interaction.user.id);
            return interaction.reply({ content: '❌ Tijd verlopen. Meld opnieuw.', ephemeral: true });
          }

          if (id === 'incident_review_edit') {
            await interaction.showModal(
              buildIncidentModal({
                raceName: pending.raceName,
                round: pending.round,
                description: pending.description
              })
            );
            return;
          }

          await interaction.deferReply({ ephemeral: true });
          await submitIncidentReport(interaction, pending);
          return;
        }

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
            const incidentLabel = pending.incidentNumber ? ` voor **${pending.incidentNumber}**` : '';
            pending.expiresAt = Date.now() + evidenceWindowMs;
            pending.promptMessageId = null;
            pendingEvidence.set(interaction.user.id, pending);
            if (interaction.message.deletable) {
              await interaction.message.delete().catch(() => {});
            }
            return interaction.reply({
              content:
                pendingType === 'appeal'
                  ? `✅ Je kunt extra beelden uploaden${incidentLabel} voor je wederwoord. Upload binnen 5 minuten.`
                  : `✅ Je kunt extra beelden uploaden${incidentLabel}. Upload binnen 5 minuten.`,
              ephemeral: true
            });
          }

          const incidentLabel = pending.incidentNumber ? ` voor **${pending.incidentNumber}**` : '';
          pendingEvidence.delete(interaction.user.id);
          if (interaction.message.deletable) {
            await interaction.message.delete().catch(() => {});
          }
          return interaction.reply({
            content:
              pendingType === 'appeal'
                ? `✅ Wederwoord${incidentLabel} afgerond. Bedankt voor het bewijs.`
                : `✅ Incident${incidentLabel} afgerond. Bedankt voor het bewijs.`,
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
          incidentData.votes[interaction.user.id] = {
            category: null,
            plus: false,
            minus: false,
            reporterCategory: null,
            reporterPlus: false,
            reporterMinus: false
          };
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
          const cat = id.replace('vote_', '');
          incidentData.votes[interaction.user.id].category = cat;

          // Update tussenstand in embed
          const tally = buildTallyText(incidentData.votes);
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === '📊 Tussenstand (Dader)');
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          newEmbed.setFields(fields);

          await interaction.message.edit({ embeds: [newEmbed] });
          return interaction.reply({ content: `✅ Stem geregistreerd: **${cat.toUpperCase()}**`, ephemeral: true });
        }

        // Categorie stemmen (indiener)
        if (id.startsWith('vote_reporter_cat')) {
          const cat = id.replace('vote_reporter_', '');
          incidentData.votes[interaction.user.id].reporterCategory = cat;

          const tally = buildTallyText(incidentData.votes, 'reporter');
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === '📊 Tussenstand (Indiener)');
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          newEmbed.setFields(fields);

          await interaction.message.edit({ embeds: [newEmbed] });
          return interaction.reply({ content: `✅ Stem geregistreerd: **${cat.toUpperCase()}** (indiener)`, ephemeral: true });
        }

        // + Strafpunt toggle (aan/uit)
        if (id === 'vote_plus') {
          const entry = incidentData.votes[interaction.user.id];
          entry.plus = !entry.plus;

          // Optioneel: voorkom dat plus & minus tegelijk aan staan
          if (entry.plus) entry.minus = false;

          const tally = buildTallyText(incidentData.votes);
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === '📊 Tussenstand (Dader)');
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

          const tally = buildTallyText(incidentData.votes);
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === '📊 Tussenstand (Dader)');
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          newEmbed.setFields(fields);

          await interaction.message.edit({ embeds: [newEmbed] });
          return interaction.reply({
            content: `✅ - Strafpunt is nu **${entry.minus ? 'AAN' : 'UIT'}** (voor jouw stem)`,
            ephemeral: true
          });
        }

        // + Strafpunt toggle (indiener)
        if (id === 'vote_reporter_plus') {
          const entry = incidentData.votes[interaction.user.id];
          entry.reporterPlus = !entry.reporterPlus;

          if (entry.reporterPlus) entry.reporterMinus = false;

          const tally = buildTallyText(incidentData.votes, 'reporter');
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === '📊 Tussenstand (Indiener)');
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          newEmbed.setFields(fields);

          await interaction.message.edit({ embeds: [newEmbed] });
          return interaction.reply({
            content: `✅ + Strafpunt is nu **${entry.reporterPlus ? 'AAN' : 'UIT'}** (indiener)`,
            ephemeral: true
          });
        }

        // - Strafpunt toggle (indiener)
        if (id === 'vote_reporter_minus') {
          const entry = incidentData.votes[interaction.user.id];
          entry.reporterMinus = !entry.reporterMinus;

          if (entry.reporterMinus) entry.reporterPlus = false;

          const tally = buildTallyText(incidentData.votes, 'reporter');
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === '📊 Tussenstand (Indiener)');
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          newEmbed.setFields(fields);

          await interaction.message.edit({ embeds: [newEmbed] });
          return interaction.reply({
            content: `✅ - Strafpunt is nu **${entry.reporterMinus ? 'AAN' : 'UIT'}** (indiener)`,
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

        const tally = buildTallyText(incidentData.votes);
        const winner = mostVotedCategory(incidentData.votes);
        const decision = winner ? winner.toUpperCase() : 'CAT0';
        const penaltyPoints = computePenaltyPoints(incidentData.votes);
        const reporterTally = buildTallyText(incidentData.votes, 'reporter');
        const reporterWinner = mostVotedCategory(incidentData.votes, 'reporter');
        const reporterDecision = reporterWinner ? reporterWinner.toUpperCase() : 'CAT0';
        const reporterPenaltyPoints = computePenaltyPoints(incidentData.votes, 'reporter');
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
            { name: '📊 Stemresultaat (Dader)', value: `\`\`\`\n${tally}\n\`\`\`` },
            { name: '⚖️ Eindoordeel (Dader)', value: `**${decision}**`, inline: true },
            { name: '🎯 Strafpunten (Dader)', value: `**${penaltyPoints}**`, inline: true },
            { name: '📊 Stemresultaat (Indiener)', value: `\`\`\`\n${reporterTally}\n\`\`\`` },
            { name: '⚖️ Eindoordeel (Indiener)', value: `**${reporterDecision}**`, inline: true },
            { name: '🎯 Strafpunten (Indiener)', value: `**${reporterPenaltyPoints}**`, inline: true },
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
              { name: '⚖️ Eindoordeel (Dader)', value: `**${decision}**`, inline: true },
              { name: '🎯 Strafpunten (Dader)', value: `**${penaltyPoints}**`, inline: true },
              { name: '⚖️ Eindoordeel (Indiener)', value: `**${reporterDecision}**`, inline: true },
              { name: '🎯 Strafpunten (Indiener)', value: `**${reporterPenaltyPoints}**`, inline: true },
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
}

module.exports = { registerInteractionHandlers };
