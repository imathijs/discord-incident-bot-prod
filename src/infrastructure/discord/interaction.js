const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
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
} = require('../../constants');
const { buildTallyText, computePenaltyPoints, mostVotedCategory } = require('../../utils/votes');
const { buildEvidencePromptRow } = require('./evidenceUI');
const { updateIncidentStatus, updateIncidentResolution } = require('../../utils/sheets');
const { fetchTextTargetChannel, canSendToChannel } = require('../../utils/channels');
const { editMessageWithRetry } = require('../../utils/messages');
const {
  normalizeIncidentNumber,
  extractIncidentNumberFromText,
  normalizeTicketInput,
  getEmbedFieldValue,
  extractIncidentNumberFromEmbed,
  extractUserIdFromText
} = require('../../utils/incidentParsing');
const IDS = require('../../ids');
const { CreateIncident } = require('../../application/usecases/CreateIncident');
const { CastVote } = require('../../application/usecases/CastVote');
const { FinalizeIncident } = require('../../application/usecases/FinalizeIncident');
const { RequestAccusedResponse } = require('../../application/usecases/RequestAccusedResponse');
const { WithdrawIncident } = require('../../application/usecases/WithdrawIncident');
const { StateIncidentRepository } = require('../persistence/StateIncidentRepository');
const { WorkflowStateStore } = require('../persistence/WorkflowStateStore');
const { DiscordNotificationPort } = require('./DiscordNotificationPort');
const { DomainError } = require('../../domain/errors/DomainError');

function registerInteractionHandlers(client, { config, state, generateIncidentNumber }) {
  const { store } = state;

  const incidentRepository = new StateIncidentRepository({ config, store });
  const workflowState = new WorkflowStateStore({ store });
  const notificationPort = new DiscordNotificationPort({ client, config });
  const createIncident = new CreateIncident({
    incidentRepository,
    notificationPort,
    workflowState,
    clock: { now: () => Date.now() },
    idGenerator: { nextIncidentNumber: generateIncidentNumber }
  });
  const castVote = new CastVote();
  const finalizeIncident = new FinalizeIncident();
  const requestAccusedResponse = new RequestAccusedResponse();
  const withdrawIncident = new WithdrawIncident();
  const allowedGuildId = config.allowedGuildId;
  const stewardIncidentThreadId = config.stewardIncidentThreadId;
  const withdrawButtonChannelId = config.withdrawButtonChannelId;
  const stewardFinalizeChannelId = config.stewardFinalizeChannelId || config.voteChannelId;
  const isFinalizeChannelOrThread = (channel) => {
    if (!channel) return false;
    if (channel.id === stewardFinalizeChannelId) return true;
    if (channel.isThread?.() && channel.parentId === stewardFinalizeChannelId) return true;
    return false;
  };

  function isSteward(member) {
    if (!member || !config.stewardRoleId) return false;
    const roles = member.roles;
    if (!roles) return false;
    if (Array.isArray(roles)) return roles.includes(config.stewardRoleId);
    if (roles.cache?.has) return roles.cache.has(config.stewardRoleId);
    if (typeof roles.has === 'function') return roles.has(config.stewardRoleId);
    return false;
  }

  const isStewardById = async (guild, userId) => {
    if (!guild || !userId) return false;
    if (!config.stewardRoleId) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    return isSteward(member);
  };

  const getStewardInvolvementNote = async (guild, incidentData) => {
    if (!incidentData) return null;
    const [reporterIsSteward, guiltyIsSteward] = await Promise.all([
      incidentData.reporterId ? isStewardById(guild, incidentData.reporterId) : false,
      incidentData.guiltyId ? isStewardById(guild, incidentData.guiltyId) : false
    ]);
    const stewardRoles = [];
    if (reporterIsSteward) stewardRoles.push('indiener');
    if (guiltyIsSteward) stewardRoles.push('tegenpartij');
    if (stewardRoles.length === 0) return null;
    return `Steward betrokken als ${stewardRoles.join(' en ')}. Betrokken stewards mogen niet stemmen.`;
  };

  const ensureStewardNoteInEmbed = async ({ embed, guild, incidentData }) => {
    if (!embed) return { embed: null, changed: false };
    const note = await getStewardInvolvementNote(guild, incidentData);
    if (!note) return { embed, changed: false };

    const newEmbed = EmbedBuilder.from(embed);
    const fields = [...(newEmbed.data.fields ?? [])];
    if (fields.some((field) => field?.name === '⚠️ Opmerking')) {
      return { embed: newEmbed, changed: false };
    }

    const descriptionIndex = fields.findIndex((field) => field?.name === '📝 Beschrijving');
    const insertIndex = descriptionIndex >= 0 ? descriptionIndex + 1 : fields.length;
    fields.splice(insertIndex, 0, { name: '⚠️ Opmerking', value: note });
    newEmbed.setFields(fields);
    return { embed: newEmbed, changed: true };
  };

  const removePendingGuiltyReply = async (incidentNumber) => {
    if (!incidentNumber) return;
    await store.deletePendingGuiltyRepliesByIncident(incidentNumber);
  };

  const formatUserLabel = async (value, guild) => {
    const raw = String(value || '').trim();
    const userId = extractUserIdFromText(raw);
    if (!userId) return raw || 'Onbekend';
    if (!guild) return `User ${userId}`;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member?.user) return `User ${userId}`;
    return member.user.tag || member.displayName || `User ${userId}`;
  };

  const parseVoteLines = (text) => {
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const votes = new Map();
    for (const line of lines) {
      if (/^Nog geen stemmen\./i.test(line)) continue;
      const userMatch = line.match(/<@!?(\d+)>/);
      if (!userMatch) continue;
      const userId = userMatch[1];
      const parts = line.split('→');
      const tokens = (parts[1] || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const entry = { category: null, plus: false, minus: false };
      for (const token of tokens) {
        const upper = token.toUpperCase();
        if (/^CAT[0-5]$/.test(upper)) entry.category = upper.toLowerCase();
        if (token === '+1') entry.plus = true;
        if (token === '-1') entry.minus = true;
      }
      votes.set(userId, entry);
    }
    return votes;
  };

  const getDecisionColor = (decision) => {
    const normalized = String(decision || '').trim().toUpperCase();
    const catColors = {
      CAT0: '#FFFFFF',
      CAT1: '#FFD6D6',
      CAT2: '#FDE68A',
      CAT3: '#FDBA74',
      CAT4: '#F97316',
      CAT5: '#EF4444'
    };
    return catColors[normalized] || '#1068ec';
  };

  const getCatLevel = (decision) => {
    const normalized = String(decision || '').trim().toUpperCase();
    const match = normalized.match(/^CAT([0-5])$/);
    if (!match) return null;
    return Number(match[1]);
  };

  const toCatLabel = (level) => {
    if (!Number.isInteger(level)) return null;
    if (level < 0 || level > 5) return null;
    return `CAT${level}`;
  };

  const getEffectiveDecisionForSanction = ({ decision, penaltyPoints }) => {
    const base = getCatLevel(decision);
    if (base === null) return String(decision || '').trim().toUpperCase();
    const offset = Number(penaltyPoints) || 0;
    const adjusted = Math.min(5, Math.max(0, base + offset));
    return toCatLabel(adjusted);
  };

  const formatDecisionWithShift = ({ decision, penaltyPoints }) => {
    const normalized = String(decision || '').trim().toUpperCase();
    const effective = getEffectiveDecisionForSanction({ decision: normalized, penaltyPoints });
    if (!normalized || normalized === effective) return normalized || 'Onbekend';
    return `${normalized} (straf als ${effective})`;
  };

  const getSanctionText = ({ decision, penaltyPoints, cat0Outcome }) => {
    const normalized = getEffectiveDecisionForSanction({ decision, penaltyPoints });
    switch (normalized) {
      case 'CAT0':
        return String(cat0Outcome || 'No further action').trim();
      case 'CAT1':
        return '1 strafpunt';
      case 'CAT2':
        return '15 seconden tijdstraf + 2 strafpunten';
      case 'CAT3':
        return '30 seconden tijdstraf + 3 strafpunten';
      case 'CAT4':
        return '45 seconden tijdstraf + 4 strafpunten';
      case 'CAT5':
        return '60 seconden tijdstraf + 5 strafpunten';
      default:
        return `${penaltyPoints ?? 0} strafpunten`;
    }
  };

  const buildFinalizeModal = ({ finalText, cat0Outcome } = {}) => {
    const modal = new ModalBuilder()
      .setCustomId(IDS.FINALIZE_MODAL)
      .setTitle('Eindoordeel toevoegen');

    const decisionInput = new TextInputBuilder()
      .setCustomId('eindoordeel')
      .setLabel('Eindoordeel (Markdown toegestaan)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000);
    decisionInput.setPlaceholder('Voorbeeld:\n**Besluit:**\n- CAT1, 1 strafpunt\n- Motivatie: ...');
    if (finalText) {
      decisionInput.setValue(finalText);
    }

    const cat0Input = new TextInputBuilder()
      .setCustomId('cat0_uitkomst')
      .setLabel('CAT0 extra uitkomst (optioneel)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100)
      .setPlaceholder('No further action | Volgende race achteraan | DSQ | DSQ + 4 strafpunten');
    if (cat0Outcome) {
      cat0Input.setValue(cat0Outcome);
    }

    modal.addComponents(
      new ActionRowBuilder().addComponents(decisionInput),
      new ActionRowBuilder().addComponents(cat0Input)
    );
    return modal;
  };

  const buildWithdrawReasonModal = ({ reasonText } = {}) => {
    const modal = new ModalBuilder()
      .setCustomId(IDS.WITHDRAW_REASON_MODAL)
      .setTitle('Incident intrekken');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reden')
      .setLabel('Reden (optioneel, maar gewenst)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000);
    reasonInput.setPlaceholder('Waarom trek je het incident in?');
    if (reasonText) reasonInput.setValue(reasonText);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return modal;
  };

  const buildWithdrawButtonMessage = () => {
    const button = new ButtonBuilder()
      .setCustomId(IDS.WITHDRAW_INCIDENT_BUTTON)
      .setLabel('Incident intrekken')
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(button);
    const embed = new EmbedBuilder()
      .setColor('#777777')
      .setTitle('Incident intrekken')
      .setDescription(
        [
          'Ben je van gedachten veranderd?',
          'Via deze knop kan je je gemelde incident intrekken.',
          'Geef bij voorkeur ook een reden op van het terugnemen.'
        ].join('\n')
      );
    return { embeds: [embed], components: [row] };
  };

  const ensureWithdrawButtonMessage = async () => {
    const channel = await client.channels.fetch(withdrawButtonChannelId).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) return;
    try {
      const recent = await channel.messages.fetch({ limit: 50 });
      const exists = recent.some((msg) =>
        msg.components?.some((row) => row.components?.some((c) => c.customId === IDS.WITHDRAW_INCIDENT_BUTTON))
      );
      if (!exists) {
        await channel.send(buildWithdrawButtonMessage());
      }
    } catch {}
  };

  const listOpenIncidentsForUser = async (user) => {
    const items = [];
    const openIncidents = await store.listOpenIncidents({ withVotes: true });
    for (const incident of openIncidents) {
      const isReporter =
        (incident.reporterId && incident.reporterId === user.id) ||
        (!incident.reporterId && incident.reporter && incident.reporter === user.tag);
      if (!isReporter) continue;
      items.push(incident);
    }
    if (items.length) return items;

    const forumChannel = await fetchTextTargetChannel(client, config.voteChannelId);
    if (!forumChannel?.threads?.fetchActive) return items;
    const active = await forumChannel.threads.fetchActive().catch(() => null);
    if (!active?.threads?.size) return items;

    for (const thread of active.threads.values()) {
      if (!thread?.isThread?.()) continue;
      if (String(thread.name || '').startsWith('✅')) continue;
      const starter = await thread.fetchStarterMessage().catch(() => null);
      if (!starter) continue;
      const recovered = hydrateIncidentFromMessage(starter);
      if (!recovered) continue;
      const isReporter =
        (recovered.reporterId && recovered.reporterId === user.id) ||
        (!recovered.reporterId && recovered.reporter && recovered.reporter === user.tag);
      if (!isReporter) continue;
      items.push(recovered);
    }

    return items;
  };

  const buildWithdrawSelectOptions = async (incidents, guild) => {
    const options = await Promise.all(
      incidents.map(async (incident) => {
        const ticket = incident.incidentNumber || 'Onbekend';
        const opponentRaw = incident.guiltyDriver || 'Onbekend';
        const opponent = await formatUserLabel(opponentRaw, guild);
        const race = incident.raceName || '?';
        const round = incident.round || '?';
        const baseLabel = `${ticket} - vs ${opponent} - race ${race} * ronde ${round}`;
        const label = baseLabel.length > 100 ? `${baseLabel.slice(0, 97)}...` : baseLabel;
        return {
          label,
          value: incident.incidentNumber || ''
        };
      })
    );
    return options;
  };

  const parseVotesFromEmbed = (embed) => {
    const votes = {};
    const fields = embed?.fields || [];
    const reporterLabel = getEmbedFieldValue(embed, '👤 Ingediend door');
    const normalizeLabel = (value) =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const reporterNormalized = normalizeLabel(reporterLabel);
    const voteFields = fields.filter((field) => field?.name?.startsWith('🗳️ Stemmen - '));
    let reporterMatched = false;
    for (let i = 0; i < voteFields.length; i += 1) {
      const field = voteFields[i];
      if (!field?.name || !field?.value) continue;
      const label = normalizeLabel(field.name.replace('🗳️ Stemmen - ', ''));
      let isReporter = reporterNormalized && label.includes(reporterNormalized);
      if (isReporter) reporterMatched = true;
      if (!isReporter && !reporterMatched && voteFields.length > 1 && i === 1) {
        isReporter = true;
      }
      const parsed = parseVoteLines(field.value);
      for (const [userId, entry] of parsed.entries()) {
        const existing =
          votes[userId] ||
          (votes[userId] = {
            category: null,
            plus: false,
            minus: false,
            reporterCategory: null,
            reporterPlus: false,
            reporterMinus: false
          });
        if (isReporter) {
          if (entry.category) existing.reporterCategory = entry.category;
          if (entry.plus) existing.reporterPlus = true;
          if (entry.minus) existing.reporterMinus = true;
        } else {
          if (entry.category) existing.category = entry.category;
          if (entry.plus) existing.plus = true;
          if (entry.minus) existing.minus = true;
        }
      }
    }
    return votes;
  };

  const respondToInteraction = (interaction, payload) => {
    if (!interaction?.isRepliable?.()) return null;
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp(payload).catch(() => null);
    }
    return interaction.reply(payload).catch(() => null);
  };

  const extractSheetRowNumber = (embed) => {
    const footer = embed?.footer?.text || '';
    const match = String(footer).match(/SheetRow:(\d+)/i);
    return match ? Number(match[1]) : null;
  };

  const hydrateIncidentFromMessage = (message) => {
    const embed = message?.embeds?.[0];
    if (!embed) return null;
    const incidentNumber = extractIncidentNumberFromEmbed(embed);
    if (!incidentNumber) return null;
    const guiltyValue = getEmbedFieldValue(embed, '⚠️ Schuldige rijder') || 'Onbekend';
    const reporterValue = getEmbedFieldValue(embed, '👤 Ingediend door') || 'Onbekend';
    const votes = parseVotesFromEmbed(embed);
    const threadId = message?.channel?.isThread?.() ? message.channelId : null;
    return {
      votes,
      incidentNumber,
      division: getEmbedFieldValue(embed, '🏁 Divisie') || 'Onbekend',
      raceName: getEmbedFieldValue(embed, '🏁 Race') || 'Onbekend',
      round: getEmbedFieldValue(embed, '🔢 Ronde') || 'Onbekend',
      corner: getEmbedFieldValue(embed, '🏁 Circuit') || 'Onbekend',
      guiltyId: extractUserIdFromText(guiltyValue),
      guiltyDriver: guiltyValue,
      reason: getEmbedFieldValue(embed, '📌 Reden') || 'Onbekend',
      reporter: reporterValue,
      reporterId: extractUserIdFromText(reporterValue),
      sheetRowNumber: extractSheetRowNumber(embed),
      threadId
    };
  };

  const isVoteThreadChannel = (channel) =>
    !!channel?.isThread?.() && channel.parentId === config.voteChannelId;

  const threadHasResolution = async (channel) => {
    if (!channel?.messages?.fetch) return false;
    try {
      const recent = await channel.messages.fetch({ limit: 50 });
      for (const message of recent.values()) {
        const embeds = message.embeds || [];
        if (embeds.some((embed) => embed?.title === '✅ Steward Besluit')) return true;
      }
    } catch {}
    return false;
  };

  const buildIncidentThreadName = ({ incidentNumber, reporterTag, guiltyDriver, status = 'open' }) => {
    const statusPrefix = status === 'resolved' ? '✅' : '⚠️';
    const reporter = reporterTag || 'Onbekend';
    const guilty = guiltyDriver || 'Onbekend';
    const base = `${statusPrefix} ${incidentNumber} - ${reporter} vs ${guilty}`;
    if (base.length <= 100) return base;
    return `${base.slice(0, 97)}...`;
  };

  const findIncidentThreadByNumber = async (normalizedTicket) => {
    const forumChannel = await fetchTextTargetChannel(client, config.voteChannelId);
    if (!forumChannel?.threads?.fetchActive) return null;
    const matchesTicket = (thread) => {
      const threadIncident = extractIncidentNumberFromText(thread?.name || '');
      return threadIncident === normalizedTicket || (thread?.name || '').toUpperCase().includes(normalizedTicket);
    };

    const active = await forumChannel.threads.fetchActive().catch(() => null);
    if (active?.threads?.size) {
      for (const thread of active.threads.values()) {
        if (matchesTicket(thread)) return thread;
      }
    }

    const archived = await forumChannel.threads.fetchArchived({ type: 'public', limit: 100 }).catch(() => null);
    if (archived?.threads?.size) {
      for (const thread of archived.threads.values()) {
        if (matchesTicket(thread)) return thread;
      }
    }

    return null;
  };

  const findIncidentMessageByNumber = async (normalizedTicket, maxMessages = 300) => {
    const thread = await findIncidentThreadByNumber(normalizedTicket);
    if (thread) {
      const starter = await thread.fetchStarterMessage().catch(() => null);
      if (starter) return { message: starter, threadId: thread.id };
    }

    const voteChannel = await fetchTextTargetChannel(client, config.voteChannelId);
    if (!voteChannel?.messages?.fetch) return null;

    let remaining = Math.max(0, maxMessages);
    let before = undefined;
    while (remaining > 0) {
      const batch = await voteChannel.messages.fetch({ limit: Math.min(100, remaining), before });
      if (!batch.size) break;
      for (const message of batch.values()) {
        const embed = message.embeds?.[0];
        const ticketFromEmbed = extractIncidentNumberFromEmbed(embed);
        const matches =
          (ticketFromEmbed && normalizeIncidentNumber(ticketFromEmbed) === normalizedTicket) ||
          normalizeIncidentNumber(message.content).includes(normalizedTicket) ||
          normalizeIncidentNumber(embed?.title).includes(normalizedTicket);
        if (matches) return { message, threadId: message.channelId };
      }
      remaining -= batch.size;
      before = batch.last().id;
    }
    return null;
  };

  const recoverIncidentByNumber = async (ticketNumber) => {
    const normalizedTicket = normalizeTicketInput(ticketNumber);
    const found = await findIncidentMessageByNumber(normalizedTicket);
    if (!found?.message) return null;
    const { message, threadId } = found;
    const incidentData = hydrateIncidentFromMessage(message);
    if (!incidentData) return null;
    const incident = {
      ...incidentData,
      id: message.id,
      threadId: threadId || message.channelId,
      status: 'OPEN'
    };
    await store.saveIncident(incident);
    await store.setVotes(message.id, incidentData.votes || {});
    return [message.id, incidentData];
  };

  const buildIncidentModal = ({ raceName, round, corner, description } = {}) => {
    const modal = new ModalBuilder().setCustomId(IDS.INCIDENT_MODAL).setTitle('Race Incident Melding');

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
    const modal = new ModalBuilder().setCustomId(IDS.APPEAL_MODAL).setTitle('Wederwoord incident');

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

  const buildDivisionRow = (prefix = IDS.INCIDENT_DIVISION_PREFIX) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${prefix}:div1`).setLabel('Div 1').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${prefix}:div2`).setLabel('Div 2').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${prefix}:div3`).setLabel('Div 3').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${prefix}:div4`).setLabel('Div 4').setStyle(ButtonStyle.Primary)
    );

  const buildReasonRows = (prefix = IDS.INCIDENT_REASON_PREFIX) => {
    const rows = [];
    const reasonsPerRow = 5;
    for (let i = 0; i < incidentReasons.length; i += reasonsPerRow) {
      const row = new ActionRowBuilder();
      const slice = incidentReasons.slice(i, i + reasonsPerRow);
      for (const reason of slice) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`${prefix}:${reason.value}`)
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
        { name: '\u200b', value: '\u200b', inline: false },
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

  const updateVoteEmbed = async ({
    interaction,
    incidentData,
    tallyType,
    tallyFieldName,
    votesFieldName,
    logLabel
  }) => {
    const tallyPrefix = tallyType === 'reporter' ? 'reporter' : '';
    const breakdownType = tallyType === 'reporter' ? 'reporter' : 'guilty';
    const tally = buildTallyText(incidentData.votes, tallyPrefix);
    const voteList = buildVoteBreakdown(incidentData.votes, breakdownType);
    const baseEmbed = interaction.message?.embeds?.[0];
    if (!baseEmbed) return false;

    let newEmbed = EmbedBuilder.from(baseEmbed);
    const fields = newEmbed.data.fields ?? [];
    const resolveFieldName = (prefix, type) => {
      const matches = fields
        .filter((f) => typeof f?.name === 'string' && f.name.startsWith(prefix))
        .map((f) => f.name);
      if (!matches.length) return null;
      if (type === 'reporter') return matches[1] || matches[0];
      return matches[0];
    };

    let tallyIndex = fields.findIndex((f) => f.name === tallyFieldName);
    if (tallyIndex < 0) {
      const resolved = resolveFieldName('📊 Tussenstand - ', tallyType);
      if (resolved) tallyFieldName = resolved;
      tallyIndex = fields.findIndex((f) => f.name === tallyFieldName);
    }
    if (tallyIndex >= 0) fields[tallyIndex].value = `\`\`\`\n${tally}\n\`\`\``;
    let votesIndex = fields.findIndex((f) => f.name === votesFieldName);
    if (votesIndex < 0) {
      const resolved = resolveFieldName('🗳️ Stemmen - ', tallyType);
      if (resolved) votesFieldName = resolved;
      votesIndex = fields.findIndex((f) => f.name === votesFieldName);
    }
    if (votesIndex >= 0) fields[votesIndex].value = voteList;
    newEmbed.setFields(fields);

    const ensured = await ensureStewardNoteInEmbed({
      embed: newEmbed,
      guild: interaction.guild,
      incidentData
    });
    newEmbed = ensured.embed || newEmbed;

    try {
      await editMessageWithRetry(
        interaction.message,
        { embeds: [newEmbed] },
        logLabel,
        { userId: interaction.user?.id }
      );
      return true;
    } catch {
      return false;
    }
  };

  const submitIncidentReport = async (interaction, pending) => {
    const reasonValue = pending.reasonValue;
    const reasonLabel = incidentReasons.find((r) => r.value === reasonValue)?.label || reasonValue;
    const stewardNote = await getStewardInvolvementNote(interaction.guild, {
      reporterId: pending.reporterId,
      guiltyId: pending.guiltyId
    });

    try {
      const result = await createIncident.execute({
        pending: { ...pending, reasonLabel },
        stewardNote,
        evidenceWindowMs,
        guiltyReplyWindowMs,
        fallbackEvidenceChannelId: interaction.channelId,
        evidenceUserId: interaction.user.id,
        pendingOwnerId: interaction.user.id
      });

      await interaction.editReply({
        content:
          `✅ Je incident-ticket **${result.incidentNumber}** is verzonden naar de stewards!\n` +
          `Je hebt zojuist een DM ontvangen van de Bot. Upload of deel je bewijsmateriaal via de DM.`
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === 'MISSING_FIELDS') {
        return interaction.editReply({
          content: '❌ Je melding mist gegevens. Klik op **Bewerken** en vul alles opnieuw in.'
        });
      }
      if (err?.code === 'VOTE_CHANNEL_MISSING') {
        return interaction.editReply({
          content: '❌ Stem-kanaal niet gevonden of is geen forum-kanaal. Check voteChannelId.'
        });
      }
      throw err;
    }
  };

  const withdrawIncidentByNumber = async ({ interaction, ticketNumber, reasonText }) => {
    const normalizedTicket = normalizeTicketInput(ticketNumber);
    let matchEntry = null;
    const incidentFromStore = await store.getIncidentByNumber(normalizedTicket);
    if (incidentFromStore?.id) {
      matchEntry = [incidentFromStore.id, incidentFromStore];
    }

    if (!matchEntry) {
      matchEntry = await recoverIncidentByNumber(ticketNumber);
    }

    if (!matchEntry) {
      await interaction.reply({
        content: '❌ Incident niet gevonden of al afgehandeld.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const [messageId, incidentData] = matchEntry;
    try {
      await withdrawIncident.execute({
        incidentData,
        userId: interaction.user.id,
        userTag: interaction.user.tag
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === 'NOT_REPORTER') {
        await interaction.reply({
          content: '❌ Alleen de melder van dit incident kan het terugnemen.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      throw err;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const respond = (payload) =>
      interaction.replied || interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload);

    const pendingEvidenceEntries = await store.listPendingEvidenceEntries();
    for (const [userId, pending] of pendingEvidenceEntries) {
      if ((pending.incidentNumber || '').toUpperCase() === normalizedTicket) {
        await store.deletePendingEvidence(userId);
      }
    }
    await removePendingGuiltyReply(incidentData.incidentNumber || ticketNumber);

    const voteChannel = await fetchTextTargetChannel(client, incidentData?.threadId || config.voteChannelId);
    if (!voteChannel) {
      await respond({ content: '❌ Stem-kanaal niet gevonden! Check voteChannelId.' });
      return true;
    }

    const voteMessage = await voteChannel.messages.fetch(messageId).catch(() => null);
    const removeFinalizeMessage = async () => {
      if (!voteChannel?.messages?.fetch) return;
      const recent = await voteChannel.messages.fetch({ limit: 50 }).catch(() => null);
      if (!recent?.size) return;
      const toDelete = recent.filter((msg) =>
        msg.components?.some((row) => row.components?.some((c) => c.customId === IDS.FINALIZE_VOTES))
      );
      for (const msg of toDelete.values()) {
        if (msg.deletable) {
          await msg.delete().catch(() => {});
        }
      }
    };
    const isResolved = voteChannel?.isThread?.() ? await threadHasResolution(voteChannel) : false;
    if (isResolved) {
      if (voteChannel?.isThread?.()) {
        await voteChannel
          .send('❌ Incident kan niet meer worden teruggenomen; incident is afgehandeld.')
          .catch(() => {});
      }
      await respond({
        content: '❌ Kan niet meer worden teruggenomen, incident is afgehandeld.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    let deleted = false;
    if (voteMessage?.deletable) {
      await voteMessage.delete().catch(() => {});
      deleted = true;
    }
    if (voteChannel?.isThread?.()) {
      await removeFinalizeMessage();
    }

    if (!deleted && voteMessage) {
      const baseEmbed = voteMessage.embeds[0]
        ? EmbedBuilder.from(voteMessage.embeds[0])
        : new EmbedBuilder().setTitle(`🚨 Incident ${incidentData.incidentNumber || 'Onbekend'}`);
      const fields = baseEmbed.data.fields ?? [];
      const statusIndex = fields.findIndex((f) => f.name === '🛑 Status');
      const statusValue = reasonText
        ? `Teruggenomen door ${interaction.user.tag}\nReden: ${reasonText}`
        : `Teruggenomen door ${interaction.user.tag}`;
      const statusField = { name: '🛑 Status', value: statusValue };
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

    const reporterMention = incidentData.reporterId ? `<@${incidentData.reporterId}>` : incidentData.reporter;
    const reasonLine = reasonText ? `\nReden: ${reasonText}` : '';

    if (voteChannel?.isThread?.()) {
      const stewardRoleId = config.incidentStewardRoleId || config.stewardRoleId;
      const stewardMention = stewardRoleId ? `<@&${stewardRoleId}>` : '@Incident steward';
      await voteChannel
        .send({
          content: reporterMention
            ? `🛑 ${stewardMention} - Incident is teruggetrokken door ${reporterMention}.${reasonLine}`
            : `🛑 ${stewardMention} - Incident is teruggetrokken door de indiener.${reasonLine}`
        })
        .catch(() => {});
    }

    const withdrawNoticeTargetId = config.withdrawNoticeChannelId;
    const resolvedChannel = withdrawNoticeTargetId
      ? await client.channels.fetch(withdrawNoticeTargetId).catch(() => null)
      : null;
    if (resolvedChannel) {
      const noticeEmbed = new EmbedBuilder()
        .setColor('#777777')
        .setTitle(`🛑 Incident Teruggenomen - ${incidentData.incidentNumber || 'Onbekend'}`)
        .setDescription(
          `Incident is door de melder teruggenomen (${reporterMention || 'Onbekend'}).` +
            (reasonText ? `\nReden: ${reasonText}` : '')
        )
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

    try {
      const dmTargets = [incidentData.guiltyId].filter(Boolean);
      for (const userId of dmTargets) {
        try {
          const user = await client.users.fetch(userId).catch(() => null);
          if (user) {
            await user.send(
              `Incident ticket ${incidentData.incidentNumber || 'Onbekend'} is ingetrokken door de melder.`
            );
          }
        } catch {}
      }
    } catch {}

    await store.saveIncident({
      ...incidentData,
      id: messageId,
      status: 'WITHDRAWN'
    });
    await respond({
      content: deleted
        ? `✅ Incident **${ticketNumber}** is verwijderd.`
        : `✅ Incident **${ticketNumber}** is teruggenomen en afgesloten.`
    });
    return true;
  };

  const handleSlashCommand = async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'raceincident') return false;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'melden') {
      if (interaction.channelId !== config.reportChannelId) {
        await interaction.reply({
          content: '❌ Incident melden kan alleen in de ingestelde forum-thread.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const reportButton = new ButtonBuilder()
        .setCustomId(IDS.REPORT_INCIDENT)
        .setLabel('🚨 Meld Incident')
        .setStyle(ButtonStyle.Danger);

      const withdrawButton = new ButtonBuilder()
        .setCustomId(IDS.WITHDRAW_INCIDENT_BUTTON)
        .setEmoji('🗑️')
        .setLabel('Incident intrekken')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(reportButton, withdrawButton);

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
      return true;
    }

    if (subcommand === 'stewardmelden') {
      if (interaction.channelId !== stewardIncidentThreadId) {
        await interaction.reply({
          content: '❌ Stewardmelding kan alleen in de ingestelde steward-thread.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (!isSteward(interaction.member)) {
        await interaction.reply({
          content: '❌ Alleen stewards kunnen namens een gebruiker melden.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const reportButton = new ButtonBuilder()
        .setCustomId(IDS.STEWARD_REPORT_INCIDENT)
        .setLabel('🧾 Melding indienen')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(reportButton);

      const embed = new EmbedBuilder()
        .setColor('#F39C12')
        .setTitle('Steward incident melding')
        .setDescription('Je kan hier als steward een melding indienen.');

      await interaction.reply({ embeds: [embed], components: [row] });
      return true;
    }

    if (subcommand === 'intrekkenknop') {
      const targetChannel = await client.channels.fetch(withdrawButtonChannelId).catch(() => null);
      if (!targetChannel?.isTextBased?.()) {
        await interaction.reply({
          content: '❌ Doel-kanaal voor intrekken-knop niet gevonden.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      await targetChannel.send(buildWithdrawButtonMessage()).catch(() => null);
      await interaction.reply({
        content: `✅ Intrekken-knop geplaatst in <#${withdrawButtonChannelId}>.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (subcommand === 'afhandelen') {
      if (!isFinalizeChannelOrThread(interaction.channel)) {
        await interaction.reply({
          content: '❌ Afhandelen kan alleen in het ingestelde steward-kanaal of een thread daaronder.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (!isSteward(interaction.member)) {
        await interaction.reply({ content: '❌ Alleen stewards kunnen afhandelen!', flags: MessageFlags.Ephemeral });
        return true;
      }

      const ticketNumber = interaction.options.getString('ticketnummer', true).trim();
      const normalizedTicket = normalizeTicketInput(ticketNumber);
      let matchEntry = null;
      const incidentFromStore = await store.getIncidentByNumber(normalizedTicket);
      if (incidentFromStore?.id) {
        matchEntry = [incidentFromStore.id, incidentFromStore];
      }

      if (!matchEntry) {
        matchEntry = await recoverIncidentByNumber(ticketNumber);
      }

      if (!matchEntry) {
        await interaction.reply({
          content: '❌ Incident niet gevonden of al afgehandeld.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const [messageId, incidentData] = matchEntry;
      await store.setPendingFinalization(interaction.user.id, {
        messageId,
        channelId: incidentData?.threadId || interaction.channelId,
        expiresAt: Date.now() + finalizeWindowMs,
        incidentNumber: incidentData?.incidentNumber || normalizedTicket,
        incidentSnapshot: incidentData || null
      });

      await interaction.showModal(buildFinalizeModal());
      return true;
    }

    if (subcommand !== 'neemterug') {
      await interaction.reply({ content: '❌ Onbekende subcommand.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const ticketNumber = interaction.options.getString('ticketnummer', true).trim();
    return withdrawIncidentByNumber({ interaction, ticketNumber, reasonText: '' });
  };

  const handleSelectMenu = async (interaction) => {
    if (!interaction.isUserSelectMenu() && !interaction.isStringSelectMenu()) return false;

    if (interaction.isStringSelectMenu() && interaction.customId === IDS.WITHDRAW_SELECT) {
      const incidentNumber = String(interaction.values?.[0] || '').trim();
      if (!incidentNumber) {
        await interaction.reply({ content: '❌ Geen incident geselecteerd.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const incidents = await listOpenIncidentsForUser(interaction.user);
      const match = incidents.find(
        (incident) => (incident.incidentNumber || '').toUpperCase() === incidentNumber.toUpperCase()
      );
      if (!match) {
        await interaction.reply({
          content: '❌ Dit incident is niet (meer) beschikbaar om in te trekken.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      await store.setPendingWithdrawal(interaction.user.id, {
        incidentNumber: match.incidentNumber,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      await interaction.showModal(buildWithdrawReasonModal());
      return true;
    }

    // 2c-steward) Reporter kiezen: daarna schuldige kiezen
    if (interaction.isUserSelectMenu() && interaction.customId === IDS.STEWARD_REPORTER_SELECT) {
      if (interaction.channelId !== stewardIncidentThreadId) {
        await interaction.reply({
          content: '❌ Stewardmelding kan alleen in de ingestelde steward-thread.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      const pending = await store.getPendingIncidentReport(interaction.user.id);
      if (!pending || pending.source !== 'steward') {
        await interaction.reply({ content: '❌ Sessie verlopen. Start opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const selectedUserId = interaction.values[0];
      const selectedUser = interaction.users.get(selectedUserId);
      pending.reporterId = selectedUserId;
      pending.reporterTag = selectedUser ? selectedUser.tag : `Onbekend (${selectedUserId})`;
      await store.setPendingIncidentReport(interaction.user.id, pending);

      const culpritSelect = new UserSelectMenuBuilder()
        .setCustomId(IDS.STEWARD_CULPRIT_SELECT)
        .setPlaceholder('Selecteer de schuldige rijder')
        .setMaxValues(1);

      const row = new ActionRowBuilder().addComponents(culpritSelect);

      await interaction.update({
        content: 'Kies de schuldige/tegenpartij.',
        components: [row]
      });
      return true;
    }

    // 2d-steward) Schuldige kiezen: daarna reden knoppen tonen
    if (interaction.isUserSelectMenu() && interaction.customId === IDS.STEWARD_CULPRIT_SELECT) {
      if (interaction.channelId !== stewardIncidentThreadId) {
        await interaction.reply({
          content: '❌ Stewardmelding kan alleen in de ingestelde steward-thread.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      const pending = await store.getPendingIncidentReport(interaction.user.id);
      if (!pending || pending.source !== 'steward') {
        await interaction.reply({ content: '❌ Sessie verlopen. Start opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const selectedUserId = interaction.values[0];
      const selectedUser = interaction.users.get(selectedUserId);
      pending.guiltyId = selectedUserId;
      pending.guiltyTag = selectedUser ? selectedUser.tag : 'Onbekend';
      await store.setPendingIncidentReport(interaction.user.id, pending);

      const reasonRows = buildReasonRows(IDS.STEWARD_INCIDENT_REASON_PREFIX);
      await interaction.update({
        content: 'Kies de reden van het incident.',
        components: reasonRows
      });
      return true;
    }

    // 3b) Dropdown submit: reden bewaren en vraag om schuldige (User Select)
    if (interaction.isStringSelectMenu() && interaction.customId === IDS.INCIDENT_REASON_SELECT) {
      if (!interaction.guildId) {
        await interaction.reply({ content: '❌ Meld een incident via het meld-kanaal.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const existing = await store.getPendingIncidentReport(interaction.user.id);
      await store.setPendingIncidentReport(interaction.user.id, {
        ...(existing || {}),
        reasonValue: interaction.values[0],
        reporterTag: interaction.user.tag,
        reporterId: interaction.user.id,
        guildId: interaction.guildId,
        expiresAt: Date.now() + incidentReportWindowMs
      });

      const userSelect = new UserSelectMenuBuilder()
        .setCustomId(IDS.INCIDENT_CULPRIT_SELECT)
        .setPlaceholder('Selecteer de schuldige rijder')
        .setMaxValues(1);

      const row = new ActionRowBuilder().addComponents(userSelect);

      await interaction.reply({
        content: 'Wie is de tegenpartij/schuldige?',
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // 3a) User Select submit: schuldige bewaren en modal tonen
    if (interaction.isUserSelectMenu() && interaction.customId === IDS.INCIDENT_CULPRIT_SELECT) {
      const pending = await store.getPendingIncidentReport(interaction.user.id);
      if (!pending) {
        await interaction.reply({ content: '❌ Sessie verlopen. Begin opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const selectedUserId = interaction.values[0];
      const selectedUser = interaction.users.get(selectedUserId);
      pending.guiltyId = selectedUserId;
      pending.guiltyTag = selectedUser ? selectedUser.tag : 'Onbekend';

      // Update pending state
      await store.setPendingIncidentReport(interaction.user.id, pending);

      await interaction.showModal(buildIncidentModal());
      return true;
    }

    return false;
  };

  const handleModalSubmit = async (interaction) => {
    if (!interaction.isModalSubmit()) return false;

    // 4) Modal submit: review tonen
    if (interaction.customId === IDS.INCIDENT_MODAL) {
      const pending = await store.getPendingIncidentReport(interaction.user.id);
      if (!pending) {
        await interaction.reply({ content: '❌ Geen open incident gevonden. Meld opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (Date.now() > pending.expiresAt) {
        await store.deletePendingIncidentReport(interaction.user.id);
        await interaction.reply({ content: '❌ Tijd verlopen. Meld opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const raceName = interaction.fields.getTextInputValue('race_naam').trim();
      const round = interaction.fields.getTextInputValue('ronde').trim();
      if (!/^\d+$/.test(raceName) || !/^\d+$/.test(round)) {
        await interaction.reply({
          content: '❌ Vul bij **Welke race?** en **Welke ronde?** alleen cijfers in. Probeer het nog een keer.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      const corner = interaction.fields.getTextInputValue('bocht').trim();
      const description = interaction.fields.getTextInputValue('beschrijving');
      pending.raceName = raceName;
      pending.round = round;
      pending.corner = corner;
      pending.description = description;
      if (!pending.incidentNumber) pending.incidentNumber = await generateIncidentNumber();
      pending.expiresAt = Date.now() + incidentReportWindowMs;
      await store.setPendingIncidentReport(interaction.user.id, pending);

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
        new ButtonBuilder().setCustomId(IDS.INCIDENT_REVIEW_EDIT).setLabel('✏️ Bewerken').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.INCIDENT_REVIEW_CONFIRM).setLabel('✅ Bevestigen').setStyle(ButtonStyle.Success)
      );

      await interaction.reply({ embeds: [reviewEmbed], components: [reviewButtons], flags: MessageFlags.Ephemeral });
      return true;
    }

    // 4b) Modal submit: wederwoord naar stewards
    if (interaction.customId === IDS.APPEAL_MODAL) {
      const pending = await store.getPendingAppeal(interaction.user.id);
      const incidentNumberInput = interaction.fields.getTextInputValue('incident_nummer').trim();
      let incidentNumber = pending?.incidentNumber || incidentNumberInput;
      try {
        const validated = await requestAccusedResponse.execute({
          mode: 'submit',
          userId: interaction.user.id,
          pending,
          incidentNumberInput,
          now: Date.now(),
          evidenceWindowMs,
          voteThreadId: null,
          dmChannelId: pending?.dmChannelId,
          appealMessageId: null,
          validateOnly: true
        });
        incidentNumber = validated.incidentNumber;
      } catch (err) {
        if (err instanceof DomainError && err.code === 'NO_PENDING') {
          await interaction.reply({ content: '❌ Geen open wederwoord gevonden. Klik opnieuw op de knop.', flags: MessageFlags.Ephemeral });
          return true;
        }
        if (err instanceof DomainError && err.code === 'EXPIRED') {
          await workflowState.clearPendingAppeal(interaction.user.id);
          await interaction.reply({ content: '❌ Tijd verlopen. Klik opnieuw op de knop.', flags: MessageFlags.Ephemeral });
          return true;
        }
        if (err instanceof DomainError && err.code === 'NOT_ALLOWED') {
          await workflowState.clearPendingAppeal(interaction.user.id);
          await interaction.reply({ content: '❌ Alleen de schuldige rijder kan dit wederwoord indienen.', flags: MessageFlags.Ephemeral });
          return true;
        }
        if (err instanceof DomainError && err.code === 'MISSING_INCIDENT') {
          await interaction.reply({ content: '❌ Incidentnummer ontbreekt.', flags: MessageFlags.Ephemeral });
          return true;
        }
        throw err;
      }
      const story = interaction.fields.getTextInputValue('verhaal');
      const evidenceLinks = interaction.fields.getTextInputValue('bewijs_links') || 'Geen bewijs geüpload';

      const incidentThread = await findIncidentThreadByNumber(normalizeTicketInput(incidentNumber));
      const voteChannel = await fetchTextTargetChannel(
        client,
        incidentThread?.id || config.voteChannelId
      );
      if (!voteChannel) {
        await interaction.reply({ content: '❌ Steward-kanaal niet gevonden! Check voteChannelId.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const appealEmbed = new EmbedBuilder()
        .setColor('#1E90FF')
        .setTitle(`🗣️ Wederwoord - ${incidentNumber}`)
        .setDescription([story, evidenceLinks].filter(Boolean).join('\n'))
        .setTimestamp();

      const appealMessage = await voteChannel.send({
        content: `<@&${config.stewardRoleId}> - Wederwoord ontvangen voor incident ${incidentNumber}`,
        embeds: [appealEmbed]
      });

      try {
        const result = await requestAccusedResponse.execute({
          mode: 'submit',
          userId: interaction.user.id,
          pending,
          incidentNumberInput,
          now: Date.now(),
          evidenceWindowMs,
          voteThreadId: incidentThread?.id || null,
          dmChannelId: pending?.dmChannelId,
          appealMessageId: appealMessage.id
        });
        incidentNumber = result.incidentNumber;
        if (result.evidencePayload) {
          await workflowState.setPendingEvidence(interaction.user.id, result.evidencePayload);
        }
        await workflowState.clearPendingAppeal(interaction.user.id);
      } catch (err) {
        if (err instanceof DomainError && err.code === 'NO_PENDING') {
          await interaction.reply({ content: '❌ Geen open wederwoord gevonden. Klik opnieuw op de knop.', flags: MessageFlags.Ephemeral });
          return true;
        }
        if (err instanceof DomainError && err.code === 'EXPIRED') {
          await workflowState.clearPendingAppeal(interaction.user.id);
          await interaction.reply({ content: '❌ Tijd verlopen. Klik opnieuw op de knop.', flags: MessageFlags.Ephemeral });
          return true;
        }
        if (err instanceof DomainError && err.code === 'NOT_ALLOWED') {
          await workflowState.clearPendingAppeal(interaction.user.id);
          await interaction.reply({ content: '❌ Alleen de schuldige rijder kan dit wederwoord indienen.', flags: MessageFlags.Ephemeral });
          return true;
        }
        if (err instanceof DomainError && err.code === 'MISSING_INCIDENT') {
          await interaction.reply({ content: '❌ Incidentnummer ontbreekt.', flags: MessageFlags.Ephemeral });
          return true;
        }
        throw err;
      }

      if (pending.dmChannelId) {
        try {
          const dmChannel = await interaction.user.createDM();
          const dmIntro = await dmChannel.send(
            '✅ Je wederwoord is doorgestuurd naar de stewards.\n' +
              'Upload of stuur een link naar je bewijsmateriaal in dit kanaal binnen 10 minuten om het automatisch toe te voegen.'
          );
          const current = await store.getPendingEvidence(interaction.user.id);
          if (current) {
            await workflowState.setPendingEvidence(interaction.user.id, {
              ...current,
              botMessageIds: [...(current.botMessageIds || []), dmIntro.id]
            });
          }
        } catch {}
      }

      await interaction.reply({
        content: pending.dmChannelId
          ? '✅ Wederwoord ontvangen! Check je DM voor eventuele beelden.'
          : '✅ Wederwoord ontvangen! Het is doorgestuurd naar de stewards.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.customId === IDS.WITHDRAW_REASON_MODAL) {
      const pending = await store.getPendingWithdrawal(interaction.user.id);
      if (!pending) {
        await interaction.reply({ content: '❌ Geen open intrek-actie gevonden.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (Date.now() > pending.expiresAt) {
        await store.deletePendingWithdrawal(interaction.user.id);
        await interaction.reply({ content: '❌ Tijd verlopen. Probeer opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const reasonText = String(interaction.fields.getTextInputValue('reden') || '').trim();
      await store.deletePendingWithdrawal(interaction.user.id);
      return withdrawIncidentByNumber({
        interaction,
        ticketNumber: pending.incidentNumber,
        reasonText
      });
    }

    // 6) Finalize modal submit: voorvertoning tonen
    if (interaction.customId === IDS.FINALIZE_MODAL) {
      const pending = await store.getPendingFinalization(interaction.user.id);
      if (!pending) {
        await interaction.reply({ content: '❌ Geen open afsluiting gevonden.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (Date.now() > pending.expiresAt) {
        await store.deletePendingFinalization(interaction.user.id);
        await interaction.reply({ content: '❌ Tijd verlopen. Probeer opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (!isSteward(interaction.member)) {
        await store.deletePendingFinalization(interaction.user.id);
        await interaction.reply({ content: '❌ Alleen stewards kunnen afsluiten!', flags: MessageFlags.Ephemeral });
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let finalText = interaction.fields.getTextInputValue('eindoordeel').trim();
      const cat0Outcome = String(interaction.fields.getTextInputValue('cat0_uitkomst') || '').trim();
      pending.finalText = finalText;
      pending.cat0Outcome = cat0Outcome;
      pending.stage = 'preview';
      await store.setPendingFinalization(interaction.user.id, pending);

      let incidentData = pending.incidentSnapshot || (await store.getIncident(pending.messageId));
      const voteChannel = await fetchTextTargetChannel(client, pending.channelId || config.voteChannelId);
      if (!voteChannel) {
        await interaction.editReply({ content: '❌ Stem-kanaal niet gevonden! Check voteChannelId.' });
        return true;
      }
      const voteMessage = voteChannel
        ? await voteChannel.messages.fetch(pending.messageId).catch(() => null)
        : null;
      if (!incidentData && voteMessage) {
        const recovered = hydrateIncidentFromMessage(voteMessage);
        if (recovered) {
          await store.saveIncident({ ...recovered, id: pending.messageId, status: 'OPEN' });
          await store.setVotes(pending.messageId, recovered.votes || {});
          incidentData = recovered;
        }
      }
      if (!incidentData && pending.incidentNumber) {
        const recoveredEntry = await recoverIncidentByNumber(pending.incidentNumber);
        if (recoveredEntry) {
          const [, recovered] = recoveredEntry;
          incidentData = recovered;
        }
      }

      const voteCount = incidentData?.votes ? Object.keys(incidentData.votes).length : 0;
      const missingVotes = voteCount === 0 ? '⚠️ Waarschuwing: er zijn nog geen stemmen geregistreerd.' : null;
      const tally = voteCount > 0 ? buildTallyText(incidentData.votes) : null;
      const reporterTally = voteCount > 0 ? buildTallyText(incidentData.votes, 'reporter') : null;

      const previewEmbed = new EmbedBuilder()
        .setColor('#3498DB')
        .setTitle('👀 Voorvertoning eindoordeel')
        .setDescription(`**Eindoordeel**\n${finalText || '*Geen tekst*'}`)
        .addFields(
          { name: '🔢 Incidentnummer', value: incidentData?.incidentNumber || 'Onbekend', inline: true },
          { name: '🏁 Divisie', value: incidentData?.division || 'Onbekend', inline: true },
          { name: '🏁 Race', value: incidentData?.raceName || 'Onbekend', inline: true },
          { name: '🔢 Ronde', value: incidentData?.round || 'Onbekend', inline: true },
          { name: '👤 Ingediend door', value: incidentData?.reporter || 'Onbekend', inline: true },
          { name: '⚠️ Rijder', value: incidentData?.guiltyDriver || 'Onbekend', inline: true },
          { name: '📌 Reden', value: incidentData?.reason || 'Onbekend', inline: false }
        )
        .setFooter({ text: 'Controleer de opmaak. Bevestig om te publiceren.' });

      if (cat0Outcome) {
        previewEmbed.addFields({ name: '🧩 CAT0 extra uitkomst', value: cat0Outcome });
      }

      if (tally) {
        previewEmbed.addFields({ name: '📊 Stemresultaat (Dader)', value: `\`\`\`\n${tally}\n\`\`\`` });
      }
      if (reporterTally) {
        previewEmbed.addFields({ name: '📊 Stemresultaat (Indiener)', value: `\`\`\`\n${reporterTally}\n\`\`\`` });
      }

      const previewRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(IDS.FINALIZE_CONFIRM).setLabel('✅ Bevestigen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(IDS.FINALIZE_EDIT).setLabel('✏️ Bewerken').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(IDS.FINALIZE_CANCEL).setLabel('❌ Annuleren').setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: missingVotes ? `Voorvertoning van het eindoordeel:\n${missingVotes}` : 'Voorvertoning van het eindoordeel:',
        embeds: [previewEmbed],
        components: [previewRow]
      });
      return true;
    }

    return false;
  };

  const finalizeWithText = async ({ finalText, pending, interaction }) => {
    const respond = (payload) =>
      interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
    const voteChannel = await fetchTextTargetChannel(client, pending.channelId || config.voteChannelId);
    if (!voteChannel) {
      return respond({ content: '❌ Stem-kanaal niet gevonden! Check voteChannelId.', flags: MessageFlags.Ephemeral });
    }

    const voteMessage = await voteChannel.messages.fetch(pending.messageId).catch(() => null);
    let incidentData = await store.getIncident(pending.messageId);
    if (!incidentData && voteMessage) {
      const recovered = hydrateIncidentFromMessage(voteMessage);
      if (recovered) {
        await store.saveIncident({ ...recovered, id: pending.messageId, status: 'OPEN' });
        await store.setVotes(pending.messageId, recovered.votes || {});
        incidentData = recovered;
      }
    }

    if (!incidentData) {
      await store.deletePendingFinalization(interaction.user.id);
      return respond({ content: '❌ Incident niet gevonden of al afgehandeld.', flags: MessageFlags.Ephemeral });
    }

    if (!voteMessage) {
      await store.deletePendingFinalization(interaction.user.id);
      return respond({ content: '❌ Stem-bericht niet gevonden.', flags: MessageFlags.Ephemeral });
    }

    const {
      tally,
      decision,
      penaltyPoints,
      reporterTally,
      reporterDecision,
      reporterPenaltyPoints,
      finalTextValue
    } = await finalizeIncident.execute({ incidentData, finalText });
    const cat0Outcome = String(pending.cat0Outcome || '').trim();
    const daderSanction = getSanctionText({ decision, penaltyPoints, cat0Outcome });
    const reporterSanction = getSanctionText({
      decision: reporterDecision,
      penaltyPoints: reporterPenaltyPoints,
      cat0Outcome: ''
    });
    const daderDecisionDisplay = formatDecisionWithShift({ decision, penaltyPoints });
    const reporterDecisionDisplay = formatDecisionWithShift({
      decision: reporterDecision,
      penaltyPoints: reporterPenaltyPoints
    });

    const threadReporterLabel = await formatUserLabel(incidentData.reporter, voteChannel.guild);
    const threadGuiltyLabel = await formatUserLabel(incidentData.guiltyDriver, voteChannel.guild);
    const resultEmbed = new EmbedBuilder()
      .setColor(getDecisionColor(decision))
      .setTitle('✅ Steward Besluit')
      .setDescription(
        `👤 Ingediend door: ${threadReporterLabel || 'Onbekend'}\n\n` +
          `**Eindoordeel**\n${finalTextValue}`
      )
      .addFields(
        { name: '🔢 Incidentnummer', value: incidentData.incidentNumber || 'Onbekend', inline: true },
        { name: '🏁 Divisie', value: incidentData.division || 'Onbekend', inline: true },
        { name: '🏁 Race', value: incidentData.raceName, inline: true },
        { name: '⚠️ Rijder', value: threadGuiltyLabel || 'Onbekend', inline: true },
        { name: '📊 Stemresultaat (Dader)', value: `\`\`\`\n${tally}\n\`\`\`` },
        { name: '⚖️ Besluit (Dader)', value: `**${daderDecisionDisplay}**`, inline: true },
        { name: '🚨 Straf (Dader)', value: `**${daderSanction}**`, inline: true },
        { name: '📊 Stemresultaat (Indiener)', value: `\`\`\`\n${reporterTally}\n\`\`\`` },
        { name: '⚖️ Besluit (Indiener)', value: `**${reporterDecisionDisplay}**`, inline: true },
        { name: '🚨 Straf (Indiener)', value: `**${reporterSanction}**`, inline: true }
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
    const resultMessage = await voteMessage.reply({ embeds: [resultEmbed] });

    await store.saveIncident({
      ...incidentData,
      id: pending.messageId,
      status: 'FINALIZED',
      outcome: {
        decision,
        finalizedAt: Date.now(),
        publishedMessageId: resultMessage?.id || null
      }
    });
    await removePendingGuiltyReply(incidentData.incidentNumber);
    await store.deletePendingFinalization(interaction.user.id);

    const resolvedTargetId = config.resolvedThreadId || config.resolvedChannelId;
    void (async () => {
      try {
        const resolvedChannel = resolvedTargetId
          ? await fetchTextTargetChannel(client, resolvedTargetId)
          : null;
        if (resolvedChannel) {
          const botMember =
            resolvedChannel.guild?.members?.me ||
            (resolvedChannel.guild ? await resolvedChannel.guild.members.fetchMe().catch(() => null) : null);
          if (!canSendToChannel(resolvedChannel, botMember)) {
            await respondToInteraction(interaction, {
              content:
                '⚠️ Bot heeft geen rechten om te posten in het resolved thread-kanaal. ' +
                `Controleer "Send Messages in Threads" op <#${resolvedTargetId}>.`,
              flags: MessageFlags.Ephemeral
            });
            return;
          }
          const reporterLabel = await formatUserLabel(incidentData.reporter, resolvedChannel.guild);
          const guiltyLabel = await formatUserLabel(incidentData.guiltyDriver, resolvedChannel.guild);
          const finalTextRaw = String(finalTextValue || '').trim() || '*Geen eindoordeel ingevuld*';
          const fieldMax = 1024;
          const finalTextChunks = [];
          for (let i = 0; i < finalTextRaw.length; i += fieldMax) {
            finalTextChunks.push(finalTextRaw.slice(i, i + fieldMax));
          }
          const finalDecisionFields =
            finalTextChunks.length > 0
              ? finalTextChunks.map((chunk, idx) => ({
                  name: idx === 0 ? '📝 Eindoordeel' : '📝 Eindoordeel (vervolg)',
                  value: chunk
                }))
              : [{ name: '📝 Eindoordeel', value: '*Geen eindoordeel ingevuld*' }];
          const reportEmbed = new EmbedBuilder()
            .setColor(getDecisionColor(decision))
            .setTitle(
              `Incident ${incidentData.incidentNumber || 'Onbekend'} - ` +
                `${reporterLabel || 'Onbekend'} vs ${guiltyLabel || 'Onbekend'}`
            )
            .setDescription('Status: **AFGEHANDELD**\n\nUitslag van het stewardsoverleg.')
            .addFields(
              { name: '\u200b', value: '\u200b' },
              ...finalDecisionFields,
              { name: '\u200b', value: '\u200b' },
              {
                name: '⚖️ Besluit',
                value:
                  `Dader: **${daderDecisionDisplay}**\n` +
                  `Indiener: **${reporterDecisionDisplay}**`
              },
              {
                name: '🚨 Straf',
                value:
                  `Dader: **${daderSanction}**\n` +
                  `Indiener: **${reporterSanction}**`
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

          // Update thread name to resolved status (best effort).
          if (voteChannel.isThread?.()) {
            try {
              const threadReporterLabel = await formatUserLabel(incidentData.reporter, voteChannel.guild);
              const threadGuiltyLabel = await formatUserLabel(incidentData.guiltyDriver, voteChannel.guild);
              const resolvedName = buildIncidentThreadName({
                incidentNumber: incidentData.incidentNumber || 'Onbekend',
                reporterTag: threadReporterLabel,
                guiltyDriver: threadGuiltyLabel,
                status: 'resolved'
              });
              await voteChannel.setName(resolvedName);
            } catch {}
          }

          // Verwijder de "Incident afhandlen" knop-post in de thread (best effort),
          // alleen na succesvolle publicatie in het resolved kanaal.
          if (voteChannel.isThread?.() && voteChannel.messages?.fetch) {
            try {
              const recent = await voteChannel.messages.fetch({ limit: 50 });
              const target = recent.find((msg) => {
                if (!msg?.components?.length) return false;
                const hasFinalizeButton = msg.components.some((row) =>
                  row.components?.some((c) => c.customId === IDS.FINALIZE_VOTES)
                );
                return hasFinalizeButton;
              });
              if (target?.deletable) {
                await target.delete();
              }
            } catch {}
          }
        } else {
          console.warn('Resolved target not found or not accessible', {
            resolvedTargetId,
            incidentNumber: incidentData.incidentNumber || 'Onbekend'
          });
        }
      } catch (err) {
        console.warn('Resolved send failed', {
          resolvedTargetId,
          incidentNumber: incidentData.incidentNumber || 'Onbekend',
          error: err?.message
        });
        if (err?.code === 50013) {
          await respondToInteraction(interaction, {
            content:
              '⚠️ Kon niet posten in het resolved thread-kanaal door ontbrekende permissies. ' +
              `Controleer of de bot "Send Messages in Threads" heeft voor <#${resolvedTargetId}>.`,
            flags: MessageFlags.Ephemeral
          });
        }
      }

      try {
        await updateIncidentResolution({
          config,
          rowNumber: incidentData.sheetRowNumber,
          status: 'Afgehandeld',
          stewardReport: finalTextValue
        });
      } catch (err) {
        console.warn('Update incident resolution failed', {
          incidentNumber: incidentData.incidentNumber || 'Onbekend',
          error: err?.message
        });
      }

      try {
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
      } catch (err) {
        console.warn('Resolved DM notify failed', {
          incidentNumber: incidentData.incidentNumber || 'Onbekend',
          error: err?.message
        });
      }
    })();

    return respond({ content: '✅ Incident afgehandeld!', flags: MessageFlags.Ephemeral });
  };

  const handleButton = async (interaction) => {
    if (!interaction.isButton()) return false;
    const id = interaction.customId;

    // 2) Meld-knop: start in DM
    if (id === IDS.REPORT_INCIDENT) {
      if (interaction.channelId !== config.reportChannelId) {
        await interaction.reply({
          content: '❌ Incident melden kan alleen in het meld-kanaal.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const divisionRow = buildDivisionRow();

      await interaction.reply({
        content: 'In welke divisie rij je?',
        components: [divisionRow],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (id === IDS.STEWARD_REPORT_INCIDENT) {
      if (interaction.channelId !== stewardIncidentThreadId) {
        await interaction.reply({
          content: '❌ Stewardmelding kan alleen in de ingestelde steward-thread.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (!isSteward(interaction.member)) {
        await interaction.reply({
          content: '❌ Alleen stewards kunnen namens een gebruiker melden.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      await store.setPendingIncidentReport(interaction.user.id, {
        source: 'steward',
        stewardId: interaction.user.id,
        stewardTag: interaction.user.tag,
        expiresAt: Date.now() + incidentReportWindowMs
      });

      const divisionRow = buildDivisionRow(IDS.STEWARD_INCIDENT_DIVISION_PREFIX);
      await interaction.reply({
        content: 'Welke divisie?',
        components: [divisionRow],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (id === IDS.WITHDRAW_INCIDENT_BUTTON) {
      if (interaction.channelId !== withdrawButtonChannelId && interaction.channelId !== config.reportChannelId) {
        await interaction.reply({
          content: '❌ Incident intrekken kan alleen via het meld-kanaal of intrekken-kanaal.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const incidents = await listOpenIncidentsForUser(interaction.user);
      if (!incidents.length) {
        await interaction.reply({
          content: '❌ Geen open incidenten gevonden op jouw naam.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const limited = incidents.slice(0, 25);
      const options = await buildWithdrawSelectOptions(limited, interaction.guild);
      const select = new StringSelectMenuBuilder()
        .setCustomId(IDS.WITHDRAW_SELECT)
        .setPlaceholder('Kies een incident om in te trekken')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(select);
      const extraNote =
        incidents.length > 25
          ? '\nJe hebt meer dan 25 open incidenten. Gebruik /raceincident neemterug <ticketnummer> voor overige.'
          : '';

      await interaction.reply({
        content: `Welk incident wil je intrekken?${extraNote}`,
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // 2b) Divisie selecteren: daarna reden knoppen tonen
    if (id.startsWith(`${IDS.INCIDENT_DIVISION_PREFIX}:`)) {
      if (!interaction.guildId) {
        await interaction.reply({ content: '❌ Meld een incident via het meld-kanaal.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const divisionValue = interaction.customId.split(':')[1] || '';
      const divisionMap = {
        div1: 'Div 1',
        div2: 'Div 2',
        div3: 'Div 3',
        div4: 'Div 4'
      };
      const division = divisionMap[divisionValue] || 'Onbekend';

      const existing = await store.getPendingIncidentReport(interaction.user.id);
      await store.setPendingIncidentReport(interaction.user.id, {
        ...(existing || {}),
        division,
        reporterTag: interaction.user.tag,
        reporterId: interaction.user.id,
        guildId: interaction.guildId,
        expiresAt: Date.now() + incidentReportWindowMs
      });

      const reasonRows = buildReasonRows(IDS.INCIDENT_REASON_PREFIX);
      await interaction.update({
        content: 'Kies de reden van het incident.',
        components: reasonRows
      });
      return true;
    }

    // 2b-steward) Divisie selecteren: daarna reporter kiezen
    if (id.startsWith(`${IDS.STEWARD_INCIDENT_DIVISION_PREFIX}:`)) {
      if (interaction.channelId !== stewardIncidentThreadId) {
        await interaction.reply({
          content: '❌ Stewardmelding kan alleen in de ingestelde steward-thread.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (!isSteward(interaction.member)) {
        await interaction.reply({
          content: '❌ Alleen stewards kunnen namens een gebruiker melden.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const pending = await store.getPendingIncidentReport(interaction.user.id);
      if (!pending || pending.source !== 'steward') {
        await interaction.reply({ content: '❌ Sessie verlopen. Start opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const divisionValue = interaction.customId.split(':')[1] || '';
      const divisionMap = {
        div1: 'Div 1',
        div2: 'Div 2',
        div3: 'Div 3',
        div4: 'Div 4'
      };
      const division = divisionMap[divisionValue] || 'Onbekend';

      await store.setPendingIncidentReport(interaction.user.id, {
        ...pending,
        division,
        expiresAt: Date.now() + incidentReportWindowMs
      });

      const reporterSelect = new UserSelectMenuBuilder()
        .setCustomId(IDS.STEWARD_REPORTER_SELECT)
        .setPlaceholder('Voor wie dien je hem in?')
        .setMaxValues(1);

      const row = new ActionRowBuilder().addComponents(reporterSelect);

      await interaction.update({
        content: 'Voor wie dien je hem in?',
        components: [row]
      });
      return true;
    }

    // 2e-steward) Reden kiezen: daarna modal tonen
    if (id.startsWith(`${IDS.STEWARD_INCIDENT_REASON_PREFIX}:`)) {
      if (interaction.channelId !== stewardIncidentThreadId) {
        await interaction.reply({
          content: '❌ Stewardmelding kan alleen in de ingestelde steward-thread.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      const pending = await store.getPendingIncidentReport(interaction.user.id);
      if (!pending || pending.source !== 'steward') {
        await interaction.reply({ content: '❌ Sessie verlopen. Start opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const reasonValue = interaction.customId.split(':')[1] || '';
      pending.reasonValue = reasonValue;
      pending.expiresAt = Date.now() + incidentReportWindowMs;
      await store.setPendingIncidentReport(interaction.user.id, pending);

      await interaction.showModal(buildIncidentModal());
      return true;
    }

    // 2c) Wederwoord-knop vanuit afgehandeld incident
    if (id.startsWith(`${IDS.APPEAL_RESOLVED_PREFIX}:`)) {
      const [, incidentNumberRaw, guiltyId] = interaction.customId.split(':');
      const incidentNumber = incidentNumberRaw || '';
      if (!guiltyId) {
        await interaction.reply({
          content: '❌ Kan schuldige rijder niet bepalen.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      try {
        const payload = await requestAccusedResponse.execute({
          mode: 'init',
          userId: interaction.user.id,
          guiltyId,
          incidentNumberInput: incidentNumber,
          now: Date.now(),
          appealWindowMs
        });
        await workflowState.setPendingAppeal(interaction.user.id, payload);
        await interaction.showModal(buildAppealModal({ incidentNumber }));
      } catch (err) {
        if (err instanceof DomainError && err.code === 'NOT_ALLOWED') {
          await interaction.reply({
            content: '❌ Alleen de schuldige rijder kan dit wederwoord indienen.',
            flags: MessageFlags.Ephemeral
          });
          return true;
        }
        throw err;
      }
      return true;
    }

    // 3) Optielijst submit: reden bewaren en vraag om schuldige (User Select)
    if (id.startsWith(`${IDS.INCIDENT_REASON_PREFIX}:`)) {
      if (!interaction.guildId) {
        await interaction.reply({ content: '❌ Meld een incident via het meld-kanaal.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const reasonValue = interaction.customId.split(':')[1] || '';
      const existing = await store.getPendingIncidentReport(interaction.user.id);
      await store.setPendingIncidentReport(interaction.user.id, {
        ...(existing || {}),
        reasonValue,
        reporterTag: interaction.user.tag,
        reporterId: interaction.user.id,
        guildId: interaction.guildId,
        expiresAt: Date.now() + incidentReportWindowMs
      });

      const userSelect = new UserSelectMenuBuilder()
        .setCustomId(IDS.INCIDENT_CULPRIT_SELECT)
        .setPlaceholder('Selecteer de schuldige rijder')
        .setMaxValues(1);

      const row = new ActionRowBuilder().addComponents(userSelect);

      await interaction.update({
        content: 'Wie is de tegenpartij/schuldige?',
        components: [row]
      });
      return true;
    }

    // Bewijs-buttons in meld-kanaal + incident review
    if (id === IDS.INCIDENT_REVIEW_EDIT || id === IDS.INCIDENT_REVIEW_CONFIRM) {
      const pending = await store.getPendingIncidentReport(interaction.user.id);
      if (!pending) {
        await interaction.reply({ content: '❌ Geen open incident gevonden. Meld opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (Date.now() > pending.expiresAt) {
        await store.deletePendingIncidentReport(interaction.user.id);
        await interaction.reply({ content: '❌ Tijd verlopen. Meld opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (id === IDS.INCIDENT_REVIEW_EDIT) {
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
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await submitIncidentReport(interaction, pending);
      return true;
    }

    if (id === evidenceButtonIds.more || id === evidenceButtonIds.done) {
      const pending = await store.getPendingEvidence(interaction.user.id);
      const pendingType = pending?.type || 'incident';
      if (!pending) {
        await interaction.reply({
          content: '❌ Geen open bewijs-upload gevonden.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (pending.channelId !== interaction.channelId) {
        await interaction.reply({
          content: '❌ Bewijs uploaden kan alleen in het juiste kanaal.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (Date.now() > pending.expiresAt) {
        await store.deletePendingEvidence(interaction.user.id);
        await interaction.reply({
          content: '❌ Tijd verlopen. Start de melding opnieuw.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (id === evidenceButtonIds.more) {
        const incidentLabel = pending.incidentNumber ? ` voor **${pending.incidentNumber}**` : '';
        pending.expiresAt = Date.now() + evidenceWindowMs;
        pending.promptMessageId = null;
        await store.setPendingEvidence(interaction.user.id, pending);
        if (interaction.message.deletable) {
          await interaction.message.delete().catch(() => {});
        }
        await interaction.reply({
          content:
            pendingType === 'appeal'
              ? `✅ Je kunt extra beelden uploaden of links delen${incidentLabel} voor je wederwoord. Upload of stuur binnen 10 minuten.`
              : `✅ Je kunt extra beelden uploaden of links delen${incidentLabel}. Upload of stuur binnen 10 minuten.`,
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const incidentLabel = pending.incidentNumber ? ` voor **${pending.incidentNumber}**` : '';
      await store.deletePendingEvidence(interaction.user.id);
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
      await interaction.reply({
        content:
          pendingType === 'appeal'
            ? `✅ Wederwoord${incidentLabel} bijgewerkt. Bedankt voor het bewijs.`
            : `✅ Incident${incidentLabel} bijgewerkt. Bedankt voor het bewijs.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (id === IDS.FINALIZE_CONFIRM || id === IDS.FINALIZE_CANCEL || id === IDS.FINALIZE_EDIT) {
      const pending = await store.getPendingFinalization(interaction.user.id);
      if (!pending || pending.stage !== 'preview') {
        await interaction.reply({ content: '❌ Geen open voorvertoning gevonden.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (Date.now() > pending.expiresAt) {
        await store.deletePendingFinalization(interaction.user.id);
        await interaction.reply({ content: '❌ Tijd verlopen. Probeer opnieuw.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!isSteward(interaction.member)) {
        await store.deletePendingFinalization(interaction.user.id);
        await interaction.reply({ content: '❌ Alleen stewards kunnen afsluiten!', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (interaction.customId === IDS.FINALIZE_EDIT) {
        await interaction.showModal(
          buildFinalizeModal({
            finalText: pending.finalText || '',
            cat0Outcome: pending.cat0Outcome || ''
          })
        );
        return true;
      }

      if (interaction.customId === IDS.FINALIZE_CANCEL) {
        await store.deletePendingFinalization(interaction.user.id);
        await interaction.update({
          content: '❌ Afhandeling geannuleerd. Start opnieuw om te bewerken.',
          components: [],
          embeds: []
        });
        return true;
      }

      const finalText = String(pending.finalText || '').trim();
      if (!finalText) {
        await store.deletePendingFinalization(interaction.user.id);
        await interaction.reply({ content: '❌ Eindoordeel ontbreekt.', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
      await interaction.editReply({ components: [] });
      await finalizeWithText({ finalText, pending, interaction });
      return true;
    }

    // 5) Stemmen / toggles / afsluiten
    let incidentData = await store.getIncident(interaction.message.id);
    if (!incidentData) {
      const recovered = hydrateIncidentFromMessage(interaction.message);
      if (recovered) {
        await store.saveIncident({ ...recovered, id: interaction.message.id, status: 'OPEN' });
        await store.setVotes(interaction.message.id, recovered.votes || {});
        incidentData = recovered;
      }
    }
    const isVoteMessage = !!incidentData;

    if (id === IDS.FINALIZE_VOTES && !isVoteMessage) {
      if (!interaction.channel?.isThread?.()) {
        await interaction.reply({
          content: '❌ Afhandelen kan alleen vanuit het incident‑thread.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      // Stemmen alleen in voteChannel
      if (interaction.channelId !== config.voteChannelId && !isVoteThreadChannel(interaction.channel)) {
        await interaction.reply({ content: '❌ Afhandelen kan alleen in het stem-kanaal.', flags: MessageFlags.Ephemeral });
        return true;
      }

      // Alleen stewards
      if (!isSteward(interaction.member)) {
        await interaction.reply({ content: '❌ Alleen stewards kunnen afhandelen!', flags: MessageFlags.Ephemeral });
        return true;
      }

      let resolvedIncident = null;
      let resolvedMessageId = interaction.message.id;
      let resolvedChannelId = interaction.channelId;

      const starter = await interaction.channel.fetchStarterMessage().catch(() => null);
      if (starter) {
        const recovered = hydrateIncidentFromMessage(starter);
        if (recovered) {
          await store.saveIncident({ ...recovered, id: starter.id, status: 'OPEN' });
          await store.setVotes(starter.id, recovered.votes || {});
          resolvedIncident = recovered;
          resolvedMessageId = starter.id;
        }
      }

      const ticketFromThread = extractIncidentNumberFromText(interaction.channel.name || '');
      if (!resolvedIncident && ticketFromThread) {
        const recoveredEntry = await recoverIncidentByNumber(ticketFromThread);
        if (recoveredEntry) {
          const [messageId, incidentDataFromStore] = recoveredEntry;
          resolvedIncident = incidentDataFromStore || null;
          resolvedMessageId = messageId || resolvedMessageId;
          resolvedChannelId = incidentDataFromStore?.threadId || resolvedChannelId;
        }
      }

      if (resolvedIncident && ticketFromThread) {
        const normalizedThreadTicket = normalizeTicketInput(ticketFromThread);
        if (resolvedIncident.incidentNumber && normalizeTicketInput(resolvedIncident.incidentNumber) !== normalizedThreadTicket) {
          await interaction.reply({
            content: '❌ Dit afhandelknopje hoort niet bij dit incident‑thread.',
            flags: MessageFlags.Ephemeral
          });
          return true;
        }
      }

      if (!resolvedIncident) {
        const recovered = hydrateIncidentFromMessage(interaction.message);
        if (recovered) {
          await store.saveIncident({ ...recovered, id: interaction.message.id, status: 'OPEN' });
          await store.setVotes(interaction.message.id, recovered.votes || {});
          resolvedIncident = recovered;
        }
      }

      if (!resolvedIncident) {
        await interaction.reply({
          content: '❌ Incident niet gevonden of al afgehandeld.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      await store.setPendingFinalization(interaction.user.id, {
        messageId: resolvedMessageId,
        channelId: resolvedChannelId,
        expiresAt: Date.now() + finalizeWindowMs,
        incidentNumber: resolvedIncident.incidentNumber || null,
        incidentSnapshot: resolvedIncident
      });

      await interaction.showModal(buildFinalizeModal());
      return true;
    }

    // Laat andere knoppen met rust
    if (!isVoteMessage) return false;

    // Stemmen alleen in voteChannel
    if (interaction.channelId !== config.voteChannelId && !isVoteThreadChannel(interaction.channel)) {
      await interaction.reply({ content: '❌ Stemmen kan alleen in het stem-kanaal.', flags: MessageFlags.Ephemeral });
      return true;
    }

    // Alleen stewards
    if (!isSteward(interaction.member)) {
      await interaction.reply({ content: '❌ Alleen stewards kunnen stemmen!', flags: MessageFlags.Ephemeral });
      return true;
    }

    try {
      await castVote.execute({
        incidentData,
        voterId: interaction.user.id,
        action: 'validate'
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === 'VOTER_INVOLVED') {
        await interaction.reply({
          content: '❌ Je bent betrokken bij dit incident (indiener/tegenpartij) en mag daarom niet stemmen.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      throw err;
    }

    // Afsluiten
    if (id === IDS.FINALIZE_VOTES) {
      await store.setPendingFinalization(interaction.user.id, {
        messageId: interaction.message.id,
        channelId: interaction.channelId,
        expiresAt: Date.now() + finalizeWindowMs
      });

      await interaction.showModal(buildFinalizeModal());
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guiltyLabel = incidentData.guiltyDriver || 'Onbekend';
    const reporterLabel = incidentData.reporter || 'Onbekend';
    const guiltyFieldName = `📊 Tussenstand - ${guiltyLabel}`;
    const reporterFieldName = `📊 Tussenstand - ${reporterLabel}`;
    const guiltyVotesFieldName = `🗳️ Stemmen - ${guiltyLabel}`;
    const reporterVotesFieldName = `🗳️ Stemmen - ${reporterLabel}`;

    // Categorie stemmen
    if (id.startsWith(IDS.VOTE_CAT_PREFIX)) {
      const cat = `cat${id.slice(IDS.VOTE_CAT_PREFIX.length)}`;
      const { isSame } = await castVote.execute({
        incidentData,
        voterId: interaction.user.id,
        action: 'category',
        target: 'guilty',
        category: cat
      });
      await store.setVote(interaction.message.id, interaction.user.id, incidentData.votes[interaction.user.id]);

      const updated = await updateVoteEmbed({
        interaction,
        incidentData,
        tallyType: 'guilty',
        tallyFieldName: guiltyFieldName,
        votesFieldName: guiltyVotesFieldName,
        logLabel: 'Vote embed update'
      });
      if (!updated) {
        await interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.' });
        return true;
      }
      await interaction.editReply({
        content: isSame
          ? '✅ Stem voor de schuldige ingetrokken.'
          : `✅ Stem geregistreerd: **${cat.toUpperCase()}**`
      });
      return true;
    }

    // Categorie stemmen (indiener)
    if (id.startsWith(IDS.VOTE_REPORTER_CAT_PREFIX)) {
      const cat = `cat${id.slice(IDS.VOTE_REPORTER_CAT_PREFIX.length)}`;
      const { isSame } = await castVote.execute({
        incidentData,
        voterId: interaction.user.id,
        action: 'category',
        target: 'reporter',
        category: cat
      });
      await store.setVote(interaction.message.id, interaction.user.id, incidentData.votes[interaction.user.id]);

      const updated = await updateVoteEmbed({
        interaction,
        incidentData,
        tallyType: 'reporter',
        tallyFieldName: reporterFieldName,
        votesFieldName: reporterVotesFieldName,
        logLabel: 'Reporter vote embed update'
      });
      if (!updated) {
        await interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.' });
        return true;
      }
      await interaction.editReply({
        content: isSame
          ? '✅ Stem voor de indiener ingetrokken.'
          : `✅ Stem geregistreerd: **${cat.toUpperCase()}** (indiener)`
      });
      return true;
    }

    // + Strafpunt toggle (aan/uit)
    if (id === IDS.VOTE_PLUS) {
      const { entry } = await castVote.execute({
        incidentData,
        voterId: interaction.user.id,
        action: 'plus',
        target: 'guilty'
      });
      await store.setVote(interaction.message.id, interaction.user.id, incidentData.votes[interaction.user.id]);

      const updated = await updateVoteEmbed({
        interaction,
        incidentData,
        tallyType: 'guilty',
        tallyFieldName: guiltyFieldName,
        votesFieldName: guiltyVotesFieldName,
        logLabel: 'Vote plus embed update'
      });
      if (!updated) {
        await interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.' });
        return true;
      }
      await interaction.editReply({
        content: `✅ + Strafpunt is nu **${entry.plus ? 'AAN' : 'UIT'}** (voor jouw stem)`
      });
      return true;
    }

    // - Strafpunt toggle (aan/uit)
    if (id === IDS.VOTE_MINUS) {
      const { entry } = await castVote.execute({
        incidentData,
        voterId: interaction.user.id,
        action: 'minus',
        target: 'guilty'
      });
      await store.setVote(interaction.message.id, interaction.user.id, incidentData.votes[interaction.user.id]);

      const updated = await updateVoteEmbed({
        interaction,
        incidentData,
        tallyType: 'guilty',
        tallyFieldName: guiltyFieldName,
        votesFieldName: guiltyVotesFieldName,
        logLabel: 'Vote minus embed update'
      });
      if (!updated) {
        await interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.' });
        return true;
      }
      await interaction.editReply({
        content: `✅ - Strafpunt is nu **${entry.minus ? 'AAN' : 'UIT'}** (voor jouw stem)`
      });
      return true;
    }

    // + Strafpunt toggle (indiener)
    if (id === IDS.VOTE_REPORTER_PLUS) {
      const { entry } = await castVote.execute({
        incidentData,
        voterId: interaction.user.id,
        action: 'plus',
        target: 'reporter'
      });
      await store.setVote(interaction.message.id, interaction.user.id, incidentData.votes[interaction.user.id]);

      const updated = await updateVoteEmbed({
        interaction,
        incidentData,
        tallyType: 'reporter',
        tallyFieldName: reporterFieldName,
        votesFieldName: reporterVotesFieldName,
        logLabel: 'Reporter vote plus embed update'
      });
      if (!updated) {
        await interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.' });
        return true;
      }
      await interaction.editReply({
        content: `✅ + Strafpunt is nu **${entry.reporterPlus ? 'AAN' : 'UIT'}** (indiener)`
      });
      return true;
    }

    // - Strafpunt toggle (indiener)
    if (id === IDS.VOTE_REPORTER_MINUS) {
      const { entry } = await castVote.execute({
        incidentData,
        voterId: interaction.user.id,
        action: 'minus',
        target: 'reporter'
      });
      await store.setVote(interaction.message.id, interaction.user.id, incidentData.votes[interaction.user.id]);

      const updated = await updateVoteEmbed({
        interaction,
        incidentData,
        tallyType: 'reporter',
        tallyFieldName: reporterFieldName,
        votesFieldName: reporterVotesFieldName,
        logLabel: 'Reporter vote minus embed update'
      });
      if (!updated) {
        await interaction.editReply({ content: '❌ Kon het stem-bericht niet bijwerken.' });
        return true;
      }
      await interaction.editReply({
        content: `✅ - Strafpunt is nu **${entry.reporterMinus ? 'AAN' : 'UIT'}** (indiener)`
      });
      return true;
    }

    return false;
  };

  client.once('clientReady', () => {
    const lockNote = allowedGuildId
      ? ` (locked to guild ${allowedGuildId})`
      : ' (DENY-ALL actief: zet ALLOWED_GUILD_ID in .env)';
    console.log(`✅ Bot is online als ${client.user.tag}${lockNote}`);
  });

  client.on('clientReady', async () => {
    const forumChannel = await fetchTextTargetChannel(client, config.voteChannelId);
    if (!forumChannel) {
      console.warn('⚠️ Forum kanaal niet gevonden voor permissie-check.', { voteChannelId: config.voteChannelId });
      return;
    }
    const botMember =
      forumChannel.guild?.members?.me ||
      (forumChannel.guild ? await forumChannel.guild.members.fetchMe().catch(() => null) : null);
    if (!botMember) {
      console.warn('⚠️ Kon bot-member niet ophalen voor permissie-check.', { voteChannelId: config.voteChannelId });
      return;
    }
    const permissions = forumChannel.permissionsFor(botMember);
    if (!permissions) {
      console.warn('⚠️ Geen permissies gevonden voor bot op forum kanaal.', { voteChannelId: config.voteChannelId });
      return;
    }
    const missing = [];
    if (!permissions.has('ViewChannel')) missing.push('ViewChannel');
    if (!permissions.has('SendMessages')) missing.push('SendMessages');
    if (!permissions.has('SendMessagesInThreads')) missing.push('SendMessagesInThreads');
    if (!permissions.has('CreatePublicThreads') && !permissions.has('CreatePrivateThreads')) {
      missing.push('CreatePosts/Threads');
    }
    if (missing.length) {
      console.warn('⚠️ Ontbrekende permissies op forum kanaal.', {
        voteChannelId: config.voteChannelId,
        missing,
        channelType: forumChannel.type,
        permissionFlags: permissions.toArray()
      });
    } else {
      console.log('✅ Forum kanaal permissies OK.', {
        voteChannelId: config.voteChannelId,
        channelType: forumChannel.type
      });
    }

    try {
      const active = await forumChannel.threads.fetchActive().catch(() => null);
      const threads = active?.threads?.values?.() || [];
      for (const thread of threads) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter?.embeds?.[0]) continue;
        const incidentData = hydrateIncidentFromMessage(starter);
        if (!incidentData) continue;
        const ensured = await ensureStewardNoteInEmbed({
          embed: starter.embeds[0],
          guild: forumChannel.guild,
          incidentData
        });
        if (!ensured.changed) continue;
        await editMessageWithRetry(
          starter,
          { embeds: [ensured.embed], components: starter.components },
          'Backfill steward note'
        );
      }
    } catch (err) {
      console.warn('⚠️ Kon steward-notities niet retroactief bijwerken.', {
        voteChannelId: config.voteChannelId,
        error: err?.message
      });
    }
  });

  client.on('clientReady', async () => {
    await ensureWithdrawButtonMessage();
  });

  // Slash command registratie
  client.on('clientReady', async () => {
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
            name: 'stewardmelden',
            description: 'Start incidentmelding namens een gebruiker (alleen steward-thread)'
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'intrekkenknop',
            description: 'Plaats een knop om incidenten in te trekken'
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

    await client.application.commands.set([]);

    if (!allowedGuildId) {
      for (const guild of client.guilds.cache.values()) {
        await guild.commands.set([]).catch(() => {});
      }
      console.error(
        'ALLOWED_GUILD_ID ontbreekt. Slash commands zijn uitgeschakeld (DENY-ALL) tot ALLOWED_GUILD_ID is gezet.'
      );
      return;
    }

    const guild = await client.guilds.fetch(allowedGuildId).catch(() => null);
    if (!guild) {
      console.error(`Guild ${allowedGuildId} niet gevonden voor commando-registratie.`);
      return;
    }
    await guild.commands.set(commands);
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!allowedGuildId) {
        try {
          await interaction.reply({
            content: '❌ Bot is vergrendeld (DENY-ALL). Steward: zet ALLOWED_GUILD_ID in de omgeving.',
            flags: MessageFlags.Ephemeral
          });
        } catch {}
        return;
      }
      if (interaction.guildId && interaction.guildId !== allowedGuildId) {
        try {
          await interaction.reply({
            content: '❌ Deze bot is alleen beschikbaar op de hoofdserver.',
            flags: MessageFlags.Ephemeral
          });
        } catch {}
        return;
      }
      if (await handleSlashCommand(interaction)) return;
      if (await handleButton(interaction)) return;
      if (await handleModalSubmit(interaction)) return;
      if (await handleSelectMenu(interaction)) return;
    } catch (err) {
      console.error(err);
      await respondToInteraction(interaction, {
        content: '❌ Er ging iets mis. Check de bot logs.',
        flags: MessageFlags.Ephemeral
      });
    }
  });
}

module.exports = { registerInteractionHandlers };
