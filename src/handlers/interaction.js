const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  UserSelectMenuBuilder,
  ApplicationCommandOptionType
} = require('discord.js');
const {
  incidentReasons,
  evidenceButtonIds,
  evidenceWindowMs,
  incidentReportWindowMs,
  appealWindowMs,
  finalizeWindowMs,
  guiltyReplyWindowMs
} = require('../constants');
const { buildTallyText, computePenaltyPoints, mostVotedCategory } = require('../utils/votes');
const { buildEvidencePromptRow } = require('../utils/evidence');
const { appendIncidentRow, updateIncidentStatus, updateIncidentResolution } = require('../utils/sheets');
const { fetchTextTargetChannel } = require('../utils/channels');
const { editMessageWithRetry } = require('../utils/messages');

function registerInteractionHandlers(client, { config, state, generateIncidentNumber }) {
  const {
    activeIncidents,
    pendingEvidence,
    pendingIncidentReports,
    pendingAppeals,
    pendingFinalizations,
    pendingGuiltyReplies
  } = state;

  function isSteward(member) {
    return member.roles?.cache?.has(config.stewardRoleId);
  }

  const pad2 = (value) => String(value).padStart(2, '0');
  const formatSheetTimestamp = (date = new Date()) => {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    return `${year}-${month}-${day} - ${hours}:${minutes}`;
  };

  const removePendingGuiltyReply = (incidentNumber) => {
    if (!incidentNumber) return;
    const normalized = incidentNumber.toUpperCase();
    for (const [userId, entries] of pendingGuiltyReplies.entries()) {
      if (!entries || typeof entries.get !== 'function') continue;
      if (entries.delete(normalized) && entries.size === 0) {
        pendingGuiltyReplies.delete(userId);
      }
    }
  };

  const buildIncidentModal = ({ raceName, round, corner, description } = {}) => {
    const modal = new ModalBuilder().setCustomId('incident_modal').setTitle('Race Incident Melding');

    const raceInput = new TextInputBuilder()
      .setCustomId('race_naam')
      .setLabel('Welke race? (alleen cijfers)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    if (raceName != null) raceInput.setValue(raceName);

    const roundInput = new TextInputBuilder()
      .setCustomId('ronde')
      .setLabel('Welke ronde? (alleen cijfers)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    if (round != null) roundInput.setValue(round);

    const cornerInput = new TextInputBuilder()
      .setCustomId('bocht')
      .setLabel('Welk circuit?')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    if (corner != null) cornerInput.setValue(corner);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('beschrijving')
      .setLabel('Beschrijving van het incident')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Max 4000 tekens (Discord-limiet)')
      .setRequired(true)
      .setMaxLength(4000);
    if (description != null) descriptionInput.setValue(description);

    modal.addComponents(
      new ActionRowBuilder().addComponents(raceInput),
      new ActionRowBuilder().addComponents(roundInput),
      new ActionRowBuilder().addComponents(cornerInput),
      new ActionRowBuilder().addComponents(descriptionInput)
    );

    return modal;
  };

  const buildAppealModal = ({ incidentNumber } = {}) => {
    const modal = new ModalBuilder().setCustomId('appeal_modal').setTitle('Wederwoord incident');

    const incidentInput = new TextInputBuilder()
      .setCustomId('incident_nummer')
      .setLabel('Incidentnummer (bijv. INC-1234)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    if (incidentNumber) incidentInput.setValue(incidentNumber);

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

    return modal;
  };

  const buildReasonRows = () => {
    const rows = [];
    const reasonsPerRow = 5;
    for (let i = 0; i < incidentReasons.length; i += reasonsPerRow) {
      const row = new ActionRowBuilder();
      const slice = incidentReasons.slice(i, i + reasonsPerRow);
      for (const reason of slice) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`incident_reason:${reason.value}`)
            .setLabel(reason.label)
            .setStyle(ButtonStyle.Primary)
        );
      }
      rows.push(row);
    }
    return rows;
  };

  const buildIncidentReviewEmbed = ({
    incidentNumber,
    division,
    raceName,
    round,
    corner,
    description,
    reasonLabel,
    guiltyMention,
    reporterTag
  }) =>
    new EmbedBuilder()
      .setColor('#FFA000')
      .setTitle(`✅ Controleer je incidentmelding - ${incidentNumber || 'Onbekend'}`)
      .addFields(
        { name: '🔢 Incidentnummer', value: incidentNumber || 'Onbekend', inline: true },
        { name: '👤 Ingediend door', value: reporterTag || 'Onbekend', inline: true },
        { name: '⚠️ Schuldige rijder', value: guiltyMention || 'Onbekend', inline: true },
        { name: '📌 Reden', value: reasonLabel || 'Onbekend', inline: false },
        { name: '🏁 Divisie', value: division || 'Onbekend', inline: true },
        { name: '🏁 Race', value: raceName || 'Onbekend', inline: true },
        { name: '🔢 Ronde', value: round || 'Onbekend', inline: true },
        { name: '🏁 Circuit', value: corner || 'Onbekend', inline: true },
        { name: '📝 Beschrijving', value: description || 'Onbekend', inline: false },
        {
          name: 'ℹ️ Let op',
          value:
            'Kies **Bewerken** om aan te passen of **Bevestigen** om te verzenden.\n' +
            'Je kunt het bewijs hierna delen of uploaden.'
        }
      );

  const buildVoteBreakdown = (votes = {}, type = 'guilty') => {
    const entries = Object.entries(votes);
    const lines = [];
    for (const [userId, entry] of entries) {
      const category = type === 'reporter' ? entry.reporterCategory : entry.category;
      const plus = type === 'reporter' ? entry.reporterPlus : entry.plus;
      const minus = type === 'reporter' ? entry.reporterMinus : entry.minus;
      if (!category && !plus && !minus) continue;
      const parts = [];
      if (category) parts.push(category.toUpperCase());
      if (plus) parts.push('+1');
      if (minus) parts.push('-1');
      lines.push(`<@${userId}> → ${parts.join(' ')}`);
    }
    if (lines.length === 0) return 'Nog geen stemmen.';
    let text = '';
    for (const line of lines) {
      if ((text + line).length + (text ? 1 : 0) > 1024) break;
      text = text ? `${text}\n${line}` : line;
    }
    return text || 'Nog geen stemmen.';
  };

  const submitIncidentReport = async (interaction, pending) => {
    const raceName = pending.raceName;
    const round = pending.round;
    const corner = pending.corner;
    const description = pending.description;
    const evidence = 'Zie uploads/links';
    const division = pending.division || 'Onbekend';

    if (!raceName || !round || !description) {
      return interaction.editReply({
        content: '❌ Je melding mist gegevens. Klik op **Bewerken** en vul alles opnieuw in.'
      });
    }

    const voteChannel = await fetchTextTargetChannel(client, config.voteChannelId);
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
    const reporterLabelName = truncateLabelName(pending.reporterTag);

    const incidentEmbed = new EmbedBuilder()
      .setColor('#FF6B00')
      .setTitle(`🚨 Incident ${incidentNumber} - ${raceName}`)
      .addFields(
        { name: '🔢 Incidentnummer', value: incidentNumber, inline: true },
        { name: '👤 Ingediend door', value: `${pending.reporterTag}`, inline: true },
        { name: '🏁 Divisie', value: division, inline: true },
        { name: '🏁 Race', value: raceName, inline: true },
        { name: '🔢 Ronde', value: round, inline: true },
        { name: '🏁 Circuit', value: corner || 'Onbekend', inline: true },
        { name: '⚠️ Schuldige rijder', value: guiltyMention || guiltyDriver, inline: true },
        { name: '📌 Reden', value: reasonLabel },
        { name: '📝 Beschrijving', value: description },
        { name: '\u200b', value: '\u200b' },
        { name: '🎥 Bewijs', value: evidence },
        { name: '\u200b', value: '\u200b' },
        { name: `📊 Tussenstand - ${guiltyDriver}`, value: 'Nog geen stemmen.' },
        { name: `📊 Tussenstand - ${pending.reporterTag}`, value: 'Nog geen stemmen.' },
        { name: `🗳️ Stemmen - ${guiltyDriver}`, value: 'Nog geen stemmen.' },
        { name: `🗳️ Stemmen - ${pending.reporterTag}`, value: 'Nog geen stemmen.' }
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
      new ButtonBuilder().setCustomId('vote_minus').setLabel('- Strafpunt').setStyle(ButtonStyle.Primary)
    );

    const reporterButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vote_reporter_cat0').setLabel('Cat 0').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vote_reporter_cat1').setLabel('Cat 1').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vote_reporter_cat2').setLabel('Cat 2').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vote_reporter_cat3').setLabel('Cat 3').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vote_reporter_cat4').setLabel('Cat 4').setStyle(ButtonStyle.Secondary)
    );

    const reporterButtonsRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vote_reporter_cat5').setLabel('Cat 5').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vote_reporter_plus').setLabel('+ Strafpunt').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vote_reporter_minus').setLabel('- Strafpunt').setStyle(ButtonStyle.Primary)
    );

    const reporterSeparatorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sep_indiener')
        .setLabel(`⬆️ ${guiltyDriver} --- ${reporterLabelName} ⬇️`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    const message = await voteChannel.send({
      content: `<@&${config.stewardRoleId}> - Incident ${incidentNumber} gemeld - ${division} - ${raceName} (${round}) - Door ${pending.reporterTag}`,
      embeds: [incidentEmbed],
      components: [voteButtons, voteButtonsRow2, reporterSeparatorRow, reporterButtons, reporterButtonsRow2]
    });

    const sheetRowNumber = await appendIncidentRow({
      config,
      row: [
        'New',
        formatSheetTimestamp(),
        division,
        guiltyDriver,
        pending.reporterTag,
        raceName,
        round,
        corner || '',
        reasonLabel,
        description,
        ''
      ]
    });

    activeIncidents.set(message.id, {
      votes: {},
      incidentNumber,
      division,
      raceName,
      round,
      corner,
      guiltyId: pending.guiltyId,
      guiltyDriver,
      reason: reasonLabel,
      reporter: pending.reporterTag,
      reporterId: pending.reporterId,
      sheetRowNumber
    });

    if (pending.guiltyId) {
      try {
        const guiltyUser = await client.users.fetch(pending.guiltyId).catch(() => null);
        if (guiltyUser) {
          const guiltyDm = await guiltyUser.createDM();
          await guiltyDm.send(
            'Er is een race incident ingediend door ' +
              `**${pending.reporterTag || 'Onbekend'}** met het incident nummer **${incidentNumber}**.\n` +
              `Het gaat om Race ${raceName} * Ronde ${round}.\n` +
              'Je hebt 2 dagen de tijd om te reageren door middel van deze DM te gebruiken.\n' +
              'DM mag maar 1x worden ingevuld en wordt toegevoegd als reactie van de tegenpartij in het stewards kanaal onder vermelding van het incident nummer.'
          );

          const normalizedIncident = incidentNumber.toUpperCase();
          const userEntries = pendingGuiltyReplies.get(pending.guiltyId) || new Map();
          userEntries.set(normalizedIncident, {
            incidentNumber,
            raceName,
            round,
            reporterTag: pending.reporterTag,
            messageId: message.id,
            channelId: guiltyDm.id,
            expiresAt: Date.now() + guiltyReplyWindowMs,
            responded: false
          });
          pendingGuiltyReplies.set(pending.guiltyId, userEntries);
        }
      } catch {}
    }

    let evidenceChannelId = interaction.channelId;
    let evidenceLocation = 'dit kanaal';
    const botMessageIds = [];
    try {
      const dmChannel = await interaction.user.createDM();
      evidenceChannelId = dmChannel.id;
      evidenceLocation = 'je DM';
      const dmIntro = await dmChannel.send(
        '✅ Je incident is verzonden naar de stewards.\n' +
          `Incidentnummer: **${incidentNumber}**\n` +
          `Upload of stuur een link naar je bewijsmateriaal voor **${incidentNumber}** in dit kanaal binnen 5 minuten om het automatisch toe te voegen.`
      );
      botMessageIds.push(dmIntro.id);
    } catch {}

    pendingEvidence.set(interaction.user.id, {
      messageId: message.id,
      channelId: evidenceChannelId,
      expiresAt: Date.now() + evidenceWindowMs,
      type: 'incident',
      incidentNumber,
      botMessageIds
    });

    pendingIncidentReports.delete(interaction.user.id);
    await interaction.editReply({
      content:
        '✅ Je incident is verzonden naar de stewards!\n' +
        `Incidentnummer: **${incidentNumber}**\n` +
        `Upload of stuur een link naar je bewijsmateriaal voor **${incidentNumber}** in ${evidenceLocation} binnen 5 minuten om het automatisch toe te voegen.`
    });
  };

  client.once('ready', () => {
    console.log(`✅ Bot is online als ${client.user.tag}`);
  });

  // Slash command registratie
  client.on('ready', async () => {
    const commands = [
      {
        name: 'raceincident',
        description: 'Incident acties',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'melden',
            description: 'Plaats een knop voor incident meldingen (in het meld-kanaal)'
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'afhandelen',
            description: 'Handel een incident af (alleen stewards-kanaal)',
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: 'ticketnummer',
                description: 'Incidentnummer (bijv. INC-1234)',
                required: true
              }
            ]
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'neemterug',
            description: 'Neem je incidentmelding terug',
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: 'ticketnummer',
                description: 'Incidentnummer (bijv. INC-1234)',
                required: true
              }
            ]
          }
        ]
      }
    ];

    await client.application.commands.set(commands);
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      // 1) Slash command: knop plaatsen
      if (interaction.isChatInputCommand() && interaction.commandName === 'raceincident') {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'melden') {
          if (interaction.channelId !== config.reportChannelId) {
            return interaction.reply({
              content: '❌ Incident melden kan alleen in de ingestelde forum-thread.',
              ephemeral: true
            });
          }

          const reportButton = new ButtonBuilder()
            .setCustomId('report_incident')
            .setLabel('🚨 Meld Incident')
            .setStyle(ButtonStyle.Danger);

          const row = new ActionRowBuilder().addComponents(reportButton);

          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('DRE - Race Incident Meldingssysteem')
            .setDescription(
              [
                'Wil je een incident melden bij de stewards van DRE?',
                'Klik dan op de knop **Meld Incident**.',
                '',
                'Je doorloopt de stappen in dit kanaal.',
                'Na het indienen ontvang je een DM om bewijsmateriaal te delen via een',
                'YouTube-link of door het zelf te uploaden.',
                '',
                'De tegenpartij zal een DM ontvangen om zijn visie op het incident toe te lichten.',
                '',
                '⚠️ **Belangrijk**',
                'Zonder bewijsmateriaal kunnen wij een incident niet beoordelen.',
                'Zorg er daarom voor dat je bewijs beschikbaar hebt, zoals:',
                '- een opname van het incident geplaatst op YouTube.',
                '- losse opname van het incident. Je upload het bestand via discord.'
              ].join('\n')
            );

          await interaction.reply({ embeds: [embed], components: [row] });
          return;
        }

        if (subcommand === 'afhandelen') {
          if (interaction.channelId !== config.voteChannelId) {
            return interaction.reply({
              content: '❌ Afhandelen kan alleen in het stewards-kanaal.',
              ephemeral: true
            });
          }

          if (!isSteward(interaction.member)) {
            return interaction.reply({ content: '❌ Alleen stewards kunnen afhandelen!', ephemeral: true });
          }

          const ticketNumber = interaction.options.getString('ticketnummer', true).trim();
          const normalizedTicket = ticketNumber.toUpperCase();
          let matchEntry = null;
          for (const entry of activeIncidents.entries()) {
            const incidentNumber = entry[1]?.incidentNumber || '';
            if (incidentNumber.toUpperCase() === normalizedTicket) {
              matchEntry = entry;
              break;
            }
          }

          if (!matchEntry) {
            return interaction.reply({
              content: '❌ Incident niet gevonden of al afgehandeld.',
              ephemeral: true
            });
          }

          const [messageId] = matchEntry;
          pendingFinalizations.set(interaction.user.id, {
            messageId,
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
            .setRequired(true)
            .setMaxLength(4000);

          modal.addComponents(new ActionRowBuilder().addComponents(decisionInput));

          await interaction.showModal(modal);
          return;
        }

        if (subcommand !== 'neemterug') {
          return interaction.reply({ content: '❌ Onbekende subcommand.', ephemeral: true });
        }

        const ticketNumber = interaction.options.getString('ticketnummer', true).trim();
        const normalizedTicket = ticketNumber.toUpperCase();
        let matchEntry = null;
        for (const entry of activeIncidents.entries()) {
          const incidentNumber = entry[1]?.incidentNumber || '';
          if (incidentNumber.toUpperCase() === normalizedTicket) {
            matchEntry = entry;
            break;
          }
        }

        if (!matchEntry) {
          return interaction.reply({
            content: '❌ Incident niet gevonden of al afgehandeld.',
            ephemeral: true
          });
        }

        const [messageId, incidentData] = matchEntry;
        const reporterId = incidentData.reporterId;
        const reporterTag = incidentData.reporter;

        if (interaction.user.id !== reporterId) {
          return interaction.reply({
            content: '❌ Alleen de indiener kan dit incident terugnemen.',
            ephemeral: true
          });
        }
        const isReporter =
          (reporterId && reporterId === interaction.user.id) ||
          (!reporterId && reporterTag && reporterTag === interaction.user.tag);

        if (!isReporter) {
          return interaction.reply({
            content: '❌ Alleen de melder van dit incident kan het terugnemen.',
            ephemeral: true
          });
        }

        for (const [userId, pending] of pendingEvidence.entries()) {
          if ((pending.incidentNumber || '').toUpperCase() === normalizedTicket) {
            pendingEvidence.delete(userId);
          }
        }
        removePendingGuiltyReply(incidentData.incidentNumber || ticketNumber);

        const voteChannel = await fetchTextTargetChannel(client, config.voteChannelId);
        if (!voteChannel) {
          return interaction.reply({
            content: '❌ Stem-kanaal niet gevonden! Check voteChannelId.',
            ephemeral: true
          });
        }

        const voteMessage = await voteChannel.messages.fetch(messageId).catch(() => null);
        let deleted = false;
        if (voteMessage?.deletable) {
          await voteMessage.delete().catch(() => {});
          deleted = true;
        }

        if (!deleted && voteMessage) {
          const baseEmbed = voteMessage.embeds[0]
            ? EmbedBuilder.from(voteMessage.embeds[0])
            : new EmbedBuilder().setTitle(`🚨 Incident ${incidentData.incidentNumber || 'Onbekend'}`);
          const fields = baseEmbed.data.fields ?? [];
          const statusIndex = fields.findIndex((f) => f.name === '🛑 Status');
          const statusField = { name: '🛑 Status', value: `Teruggenomen door ${interaction.user.tag}` };
          if (statusIndex >= 0) {
            fields[statusIndex] = statusField;
          } else {
            fields.push(statusField);
          }
          baseEmbed.setColor('#777777').setFields(fields);
          try {
            await editMessageWithRetry(
              voteMessage,
              { embeds: [baseEmbed], components: [] },
              'Withdraw incident embed update',
              { userId: interaction.user?.id }
            );
          } catch {}
        }

        const resolvedChannel = await client.channels.fetch(config.resolvedChannelId).catch(() => null);
        if (resolvedChannel) {
          const reporterMention = incidentData.reporterId ? `<@${incidentData.reporterId}>` : incidentData.reporter;
          const noticeEmbed = new EmbedBuilder()
            .setColor('#777777')
            .setTitle(`🛑 Incident Teruggenomen - ${incidentData.incidentNumber || 'Onbekend'}`)
            .setDescription(`Incident is door de melder teruggenomen (${reporterMention || 'Onbekend'}).`)
            .addFields(
              { name: '🔢 Incidentnummer', value: incidentData.incidentNumber || 'Onbekend', inline: true },
              { name: '🏁 Divisie', value: incidentData.division || 'Onbekend', inline: true },
              { name: '🏁 Race', value: incidentData.raceName || 'Onbekend', inline: true },
              { name: '🔢 Ronde', value: incidentData.round || 'Onbekend', inline: true },
              { name: '👤 Ingediend door', value: reporterMention || 'Onbekend', inline: true },
              { name: '⚠️ Rijder', value: incidentData.guiltyDriver || 'Onbekend', inline: true },
              { name: '📌 Reden', value: incidentData.reason || 'Onbekend' }
            )
            .setTimestamp();
          await resolvedChannel.send({
            content: reporterMention ? `🛑 Incident teruggenomen door ${reporterMention}.` : '🛑 Incident teruggenomen.',
            embeds: [noticeEmbed]
          }).catch(() => {});
        }

        activeIncidents.delete(messageId);
        return interaction.reply({
          content: deleted
            ? `✅ Incident **${ticketNumber}** is verwijderd.`
            : `✅ Incident **${ticketNumber}** is teruggenomen en afgesloten.`,
          ephemeral: true
        });
      }

      // 2) Meld-knop: start in DM
      if (interaction.isButton() && interaction.customId === 'report_incident') {
        if (interaction.channelId !== config.reportChannelId) {
          return interaction.reply({
            content: '❌ Incident melden kan alleen in het meld-kanaal.',
            ephemeral: true
          });
        }

        const divisionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('incident_division:div1').setLabel('Div 1').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('incident_division:div2').setLabel('Div 2').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('incident_division:div3').setLabel('Div 3').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('incident_division:div4').setLabel('Div 4').setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({
          content: 'In welke divisie rij je?',
          components: [divisionRow],
          ephemeral: true
        });
        return;
      }

      // 2b) Divisie selecteren: daarna reden knoppen tonen
      if (interaction.isButton() && interaction.customId.startsWith('incident_division:')) {
        if (!interaction.guildId) {
          return interaction.reply({ content: '❌ Meld een incident via het meld-kanaal.', ephemeral: true });
        }

        const divisionValue = interaction.customId.split(':')[1] || '';
        const divisionMap = {
          div1: 'Div 1',
          div2: 'Div 2',
          div3: 'Div 3',
          div4: 'Div 4'
        };
        const division = divisionMap[divisionValue] || 'Onbekend';

        const existing = pendingIncidentReports.get(interaction.user.id);
        pendingIncidentReports.set(interaction.user.id, {
          ...(existing || {}),
          division,
          reporterTag: interaction.user.tag,
          reporterId: interaction.user.id,
          guildId: interaction.guildId,
          expiresAt: Date.now() + incidentReportWindowMs
        });

        const reasonRows = buildReasonRows();
        await interaction.update({
          content: 'Kies de reden van het incident.',
          components: reasonRows
        });
        return;
      }

      // 2c) Wederwoord-knop vanuit afgehandeld incident
      if (interaction.isButton() && interaction.customId.startsWith('appeal_resolved:')) {
        const [, incidentNumberRaw, guiltyId] = interaction.customId.split(':');
        const incidentNumber = incidentNumberRaw || '';
        if (!guiltyId) {
          return interaction.reply({
            content: '❌ Kan schuldige rijder niet bepalen.',
            ephemeral: true
          });
        }
        if (interaction.user.id !== guiltyId) {
          return interaction.reply({
            content: '❌ Alleen de schuldige rijder kan dit wederwoord indienen.',
            ephemeral: true
          });
        }
        pendingAppeals.set(interaction.user.id, {
          expiresAt: Date.now() + appealWindowMs,
          incidentNumber,
          allowedGuiltyId: guiltyId,
          source: 'resolved'
        });
        await interaction.showModal(buildAppealModal({ incidentNumber }));
        return;
      }

      // 3) Optielijst submit: reden bewaren en vraag om schuldige (User Select)
      if (interaction.isButton() && interaction.customId.startsWith('incident_reason:')) {
        if (!interaction.guildId) {
          return interaction.reply({ content: '❌ Meld een incident via het meld-kanaal.', ephemeral: true });
        }

        const reasonValue = interaction.customId.split(':')[1] || '';
        const existing = pendingIncidentReports.get(interaction.user.id);
        pendingIncidentReports.set(interaction.user.id, {
          ...(existing || {}),
          reasonValue,
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

        await interaction.update({
          content: 'Wie is de tegenpartij/schuldige?',
          components: [row]
        });
        return;
      }

      // 3b) Dropdown submit: reden bewaren en vraag om schuldige (User Select)
      if (interaction.isStringSelectMenu() && interaction.customId === 'incident_reason') {
        if (!interaction.guildId) {
          return interaction.reply({ content: '❌ Meld een incident via het meld-kanaal.', ephemeral: true });
        }

        const existing = pendingIncidentReports.get(interaction.user.id);
        pendingIncidentReports.set(interaction.user.id, {
          ...(existing || {}),
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

        const raceName = interaction.fields.getTextInputValue('race_naam').trim();
        const round = interaction.fields.getTextInputValue('ronde').trim();
        if (!/^\d+$/.test(raceName) || !/^\d+$/.test(round)) {
          return interaction.reply({
            content: '❌ Vul bij **Welke race?** en **Welke ronde?** alleen cijfers in. Probeer het nog een keer.',
            ephemeral: true
          });
        }
        const corner = interaction.fields.getTextInputValue('bocht').trim();
        const description = interaction.fields.getTextInputValue('beschrijving');
        pending.raceName = raceName;
        pending.round = round;
        pending.corner = corner;
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
          division: pending.division,
          raceName,
          round,
          corner,
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
        if (pending.allowedGuiltyId && pending.allowedGuiltyId !== interaction.user.id) {
          pendingAppeals.delete(interaction.user.id);
          return interaction.reply({ content: '❌ Alleen de schuldige rijder kan dit wederwoord indienen.', ephemeral: true });
        }

        const incidentNumberInput = interaction.fields.getTextInputValue('incident_nummer').trim();
        const incidentNumber = pending.incidentNumber || incidentNumberInput;
        const story = interaction.fields.getTextInputValue('verhaal');
        const evidenceLinks = interaction.fields.getTextInputValue('bewijs_links') || 'Geen bewijs geüpload';

        const voteChannel = await fetchTextTargetChannel(client, config.voteChannelId);
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

        if (pending.dmChannelId) {
          pendingEvidence.set(interaction.user.id, {
            messageId: appealMessage.id,
            channelId: pending.dmChannelId,
            expiresAt: Date.now() + evidenceWindowMs,
            type: 'appeal',
            incidentNumber,
            botMessageIds: []
          });
        }

        pendingAppeals.delete(interaction.user.id);

        if (pending.dmChannelId) {
          try {
            const dmChannel = await interaction.user.createDM();
            const dmIntro = await dmChannel.send(
              '✅ Je wederwoord is doorgestuurd naar de stewards.\n' +
                'Upload of stuur een link naar je bewijsmateriaal in dit kanaal binnen 5 minuten om het automatisch toe te voegen.'
            );
            const current = pendingEvidence.get(interaction.user.id);
            if (current) {
              pendingEvidence.set(interaction.user.id, {
                ...current,
                botMessageIds: [...(current.botMessageIds || []), dmIntro.id]
              });
            }
          } catch {}
        }

        return interaction.reply({
          content: pending.dmChannelId
            ? '✅ Wederwoord ontvangen! Check je DM voor eventuele beelden.'
            : '✅ Wederwoord ontvangen! Het is doorgestuurd naar de stewards.',
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
            if (interaction.message?.deletable) {
              await interaction.message.delete().catch(() => {});
            }
            await interaction.showModal(
              buildIncidentModal({
                raceName: pending.raceName,
                round: pending.round,
                corner: pending.corner,
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
                  ? `✅ Je kunt extra beelden uploaden of links delen${incidentLabel} voor je wederwoord. Upload of stuur binnen 5 minuten.`
                  : `✅ Je kunt extra beelden uploaden of links delen${incidentLabel}. Upload of stuur binnen 5 minuten.`,
              ephemeral: true
            });
          }

          const incidentLabel = pending.incidentNumber ? ` voor **${pending.incidentNumber}**` : '';
          pendingEvidence.delete(interaction.user.id);
          if (interaction.message.deletable) {
            await interaction.message.delete().catch(() => {});
          }
          if (pending.channelId) {
            const channel = await client.channels.fetch(pending.channelId).catch(() => null);
            if (channel?.isTextBased()) {
              const toDelete = new Set(pending.botMessageIds || []);
              if (pending.promptMessageId) toDelete.add(pending.promptMessageId);
              for (const messageId of toDelete) {
                await channel.messages.delete(messageId).catch(() => {});
              }
            }
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
            .setRequired(true)
            .setMaxLength(4000);

          modal.addComponents(new ActionRowBuilder().addComponents(decisionInput));

          await interaction.showModal(modal);
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        const guiltyLabel = incidentData.guiltyDriver || 'Onbekend';
        const reporterLabel = incidentData.reporter || 'Onbekend';
        const guiltyFieldName = `📊 Tussenstand - ${guiltyLabel}`;
        const reporterFieldName = `📊 Tussenstand - ${reporterLabel}`;
        const guiltyVotesFieldName = `🗳️ Stemmen - ${guiltyLabel}`;
        const reporterVotesFieldName = `🗳️ Stemmen - ${reporterLabel}`;

        // Categorie stemmen
        if (id.startsWith('vote_cat')) {
          const cat = id.replace('vote_', '');
          const entry = incidentData.votes[interaction.user.id];
          const isSame = entry.category === cat;
          entry.category = isSame ? null : cat;

          // Update tussenstand in embed
          const tally = buildTallyText(incidentData.votes);
          const voteList = buildVoteBreakdown(incidentData.votes);
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === guiltyFieldName);
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          const listIdx = fields.findIndex((f) => f.name === guiltyVotesFieldName);
          if (listIdx >= 0) fields[listIdx].value = voteList;
          newEmbed.setFields(fields);

          try {
            await editMessageWithRetry(
              interaction.message,
              { embeds: [newEmbed] },
              'Vote embed update',
              { userId: interaction.user?.id }
            );
          } catch {
            return interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.', ephemeral: true });
          }
          return interaction.editReply({
            content: isSame
              ? '✅ Stem voor de schuldige ingetrokken.'
              : `✅ Stem geregistreerd: **${cat.toUpperCase()}**`,
            ephemeral: true
          });
        }

        // Categorie stemmen (indiener)
        if (id.startsWith('vote_reporter_cat')) {
          const cat = id.replace('vote_reporter_', '');
          const entry = incidentData.votes[interaction.user.id];
          const isSame = entry.reporterCategory === cat;
          entry.reporterCategory = isSame ? null : cat;

          const tally = buildTallyText(incidentData.votes, 'reporter');
          const voteList = buildVoteBreakdown(incidentData.votes, 'reporter');
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === reporterFieldName);
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          const listIdx = fields.findIndex((f) => f.name === reporterVotesFieldName);
          if (listIdx >= 0) fields[listIdx].value = voteList;
          newEmbed.setFields(fields);

          try {
            await editMessageWithRetry(
              interaction.message,
              { embeds: [newEmbed] },
              'Reporter vote embed update',
              { userId: interaction.user?.id }
            );
          } catch {
            return interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.', ephemeral: true });
          }
          return interaction.editReply({
            content: isSame
              ? '✅ Stem voor de indiener ingetrokken.'
              : `✅ Stem geregistreerd: **${cat.toUpperCase()}** (indiener)`,
            ephemeral: true
          });
        }

        // + Strafpunt toggle (aan/uit)
        if (id === 'vote_plus') {
          const entry = incidentData.votes[interaction.user.id];
          entry.plus = !entry.plus;
          if (entry.plus) entry.minus = false;

          const tally = buildTallyText(incidentData.votes);
          const voteList = buildVoteBreakdown(incidentData.votes);
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === guiltyFieldName);
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          const listIdx = fields.findIndex((f) => f.name === guiltyVotesFieldName);
          if (listIdx >= 0) fields[listIdx].value = voteList;
          newEmbed.setFields(fields);

          try {
            await editMessageWithRetry(
              interaction.message,
              { embeds: [newEmbed] },
              'Vote plus embed update',
              { userId: interaction.user?.id }
            );
          } catch {
            return interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.', ephemeral: true });
          }
          return interaction.editReply({
            content: `✅ + Strafpunt is nu **${entry.plus ? 'AAN' : 'UIT'}** (voor jouw stem)`,
            ephemeral: true
          });
        }

        // - Strafpunt toggle (aan/uit)
        if (id === 'vote_minus') {
          const entry = incidentData.votes[interaction.user.id];
          entry.minus = !entry.minus;
          if (entry.minus) entry.plus = false;

          const tally = buildTallyText(incidentData.votes);
          const voteList = buildVoteBreakdown(incidentData.votes);
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === guiltyFieldName);
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          const listIdx = fields.findIndex((f) => f.name === guiltyVotesFieldName);
          if (listIdx >= 0) fields[listIdx].value = voteList;
          newEmbed.setFields(fields);

          try {
            await editMessageWithRetry(
              interaction.message,
              { embeds: [newEmbed] },
              'Vote minus embed update',
              { userId: interaction.user?.id }
            );
          } catch {
            return interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.', ephemeral: true });
          }
          return interaction.editReply({
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
          const voteList = buildVoteBreakdown(incidentData.votes, 'reporter');
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === reporterFieldName);
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          const listIdx = fields.findIndex((f) => f.name === reporterVotesFieldName);
          if (listIdx >= 0) fields[listIdx].value = voteList;
          newEmbed.setFields(fields);

          try {
            await editMessageWithRetry(
              interaction.message,
              { embeds: [newEmbed] },
              'Reporter vote plus embed update',
              { userId: interaction.user?.id }
            );
          } catch {
            return interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.', ephemeral: true });
          }
          return interaction.editReply({
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
          const voteList = buildVoteBreakdown(incidentData.votes, 'reporter');
          const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
          const fields = newEmbed.data.fields ?? [];
          const idx = fields.findIndex((f) => f.name === reporterFieldName);
          if (idx >= 0) fields[idx].value = `\`\`\`\n${tally}\n\`\`\``;
          const listIdx = fields.findIndex((f) => f.name === reporterVotesFieldName);
          if (listIdx >= 0) fields[listIdx].value = voteList;
          newEmbed.setFields(fields);

          try {
            await editMessageWithRetry(
              interaction.message,
              { embeds: [newEmbed] },
              'Reporter vote minus embed update',
              { userId: interaction.user?.id }
            );
          } catch {
            return interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.', ephemeral: true });
          }
          return interaction.editReply({
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

        const voteChannel = await fetchTextTargetChannel(client, config.voteChannelId);
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
          .setDescription(
            `👤 Ingediend door: ${incidentData.reporter || 'Onbekend'}\n\n` +
              `**Eindoordeel**\n${finalText}`
          )
          .addFields(
            { name: '🔢 Incidentnummer', value: incidentData.incidentNumber || 'Onbekend', inline: true },
            { name: '🏁 Divisie', value: incidentData.division || 'Onbekend', inline: true },
            { name: '🏁 Race', value: incidentData.raceName, inline: true },
            { name: '⚠️ Rijder', value: incidentData.guiltyDriver, inline: true },
            { name: '📊 Stemresultaat (Dader)', value: `\`\`\`\n${tally}\n\`\`\`` },
            { name: '⚖️ Eindoordeel (Dader)', value: `**${decision}**`, inline: true },
            { name: '🎯 Strafpunten (Dader)', value: `**${penaltyPoints}**`, inline: true },
            { name: '📊 Stemresultaat (Indiener)', value: `\`\`\`\n${reporterTally}\n\`\`\`` },
            { name: '⚖️ Eindoordeel (Indiener)', value: `**${reporterDecision}**`, inline: true },
            { name: '🎯 Strafpunten (Indiener)', value: `**${reporterPenaltyPoints}**`, inline: true }
          )
          .setTimestamp();

        try {
          await editMessageWithRetry(
            voteMessage,
            { components: [] },
            'Finalize remove components',
            { userId: interaction.user?.id }
          );
        } catch {}
        await voteMessage.reply({ embeds: [resultEmbed] });

        const resolvedChannel = await client.channels.fetch(config.resolvedChannelId).catch(() => null);
        if (resolvedChannel) {
          const reportEmbed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle(`Incident Afgehandeld • ${incidentData.incidentNumber || 'Onbekend'}`)
            .setDescription(`Uitslag van het stewardsoverleg.\n\n**Eindoordeel**\n${finalText}`)
            .addFields(
              { name: '\u200b', value: '\u200b' },
              {
                name: '⚖️ Besluit',
                value:
                  `Dader: **${decision}**  •  Strafmaat: **${penaltyPoints}**\n` +
                  `Indiener: **${reporterDecision}**  •  Strafmaat: **${reporterPenaltyPoints}**`
              },
              { name: '\u200b', value: '\u200b' },
              {
                name: '🧾 Samenvatting',
                value:
                  `Incidentnummer: **${incidentData.incidentNumber || 'Onbekend'}**\n` +
                  `Divisie: **${incidentData.division || 'Onbekend'}**\n` +
                  `Race: **${incidentData.raceName}**  •  Ronde: **${incidentData.round}**\n` +
                  `Ingediend door: **${incidentData.reporter || 'Onbekend'}**\n` +
                  `Rijder: **${incidentData.guiltyDriver}**\n` +
                  `Reden: **${incidentData.reason || 'Onbekend'}**`
              }
            )
            .setTimestamp();
        await resolvedChannel.send({ embeds: [reportEmbed] });
        }

        await updateIncidentResolution({
          config,
          rowNumber: incidentData.sheetRowNumber,
          status: 'Afgehandeld',
          stewardReport: finalText
        });

        const resolvedThreadId = config.resolvedThreadId || config.resolvedChannelId;
        const dmText =
          `Incident ticket ${incidentData.incidentNumber || 'Onbekend'} is afgehandeld. ` +
          `Het besluit staat in kanaal Incidenten > Afgehandeld <#${resolvedThreadId}>`;
        const dmTargets = [incidentData.reporterId, incidentData.guiltyId].filter(Boolean);
        for (const userId of dmTargets) {
          try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) await user.send(dmText);
          } catch {}
        }

        activeIncidents.delete(pending.messageId);
        removePendingGuiltyReply(incidentData.incidentNumber);
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
