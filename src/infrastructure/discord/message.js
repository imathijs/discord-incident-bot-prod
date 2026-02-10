const { EmbedBuilder } = require('discord.js');
const { evidenceWindowMs, guiltyReplyWindowMs } = require('../../constants');
const { downloadAttachment, scheduleMessageDeletion } = require('../../utils/evidence');
const { fetchTextTargetChannel } = require('../../utils/channels');
const { editMessageWithRetry } = require('../../utils/messages');
const { AddEvidence } = require('../../application/usecases/AddEvidence');
const { buildEvidencePromptRow } = require('./evidenceUI');
const {
  normalizeIncidentNumber,
  extractIncidentNumberFromText,
  normalizeTicketInput,
  getEmbedFieldValue,
  extractIncidentNumberFromEmbed,
  extractUserIdFromText
} = require('../../utils/incidentParsing');

const extractUrls = (content = '') => {
  const matches = content.match(/https?:\/\/\S+/gi) || [];
  return matches
    .map((url) => url.replace(/[),.;:]+$/g, ''))
    .filter(Boolean);
};

const safeDelete = async (msg) => {
  if (msg?.deletable) await msg.delete().catch(() => {});
};

const buildIncidentLabel = async (pending, store) => {
  if (pending?.incidentNumber) return pending.incidentNumber;
  if (!pending?.messageId) return 'Onbekend';
  const incident = await store.getIncident(pending.messageId);
  return incident?.incidentNumber || 'Onbekend';
};

const hydrateIncidentFromMessage = (message) => {
  const embed = message?.embeds?.[0];
  if (!embed) return null;
  const incidentNumber = extractIncidentNumberFromEmbed(embed);
  if (!incidentNumber) return null;
  const guiltyValue = getEmbedFieldValue(embed, '⚠️ Schuldige rijder') || 'Onbekend';
  const reporterValue = getEmbedFieldValue(embed, '👤 Ingediend door') || 'Onbekend';
  return {
    incidentNumber,
    raceName: getEmbedFieldValue(embed, '🏁 Race') || 'Onbekend',
    round: getEmbedFieldValue(embed, '🔢 Ronde') || 'Onbekend',
    guiltyId: extractUserIdFromText(guiltyValue),
    guiltyDriver: guiltyValue,
    reporter: reporterValue,
    reporterId: extractUserIdFromText(reporterValue)
  };
};

const findIncidentThreadByNumber = async (client, config, normalizedTicket) => {
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

const findIncidentMessageByNumber = async (client, config, normalizedTicket, maxMessages = 300) => {
  const thread = await findIncidentThreadByNumber(client, config, normalizedTicket);
  if (thread) {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) return { message: starter, threadId: thread.id };
  }

  const voteChannel = await fetchTextTargetChannel(client, config.voteChannelId);
  if (!voteChannel?.messages?.fetch) return null;

  let remaining = Math.max(0, maxMessages);
  let before = undefined;
  while (remaining > 0) {
    const batch = await voteChannel.messages.fetch({ limit: Math.min(100, remaining), before }).catch(() => null);
    if (!batch?.size) break;
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

const updateEvidenceEmbed = async ({ voteMessage, evidenceText, authorId }) => {
  const embed = EmbedBuilder.from(voteMessage.embeds[0]);
  const fields = embed.data.fields ?? [];
  const idx = fields.findIndex((f) => f.name === '🎥 Bewijs');
  const existing = idx >= 0 ? fields[idx].value?.trim() || '' : '';
  const hasPlaceholder = existing === 'Geen bewijs geüpload' || existing === 'Zie uploads';
  const nextValue = hasPlaceholder || !existing ? evidenceText : `${existing}\n${evidenceText}`;
  if (idx >= 0) {
    fields[idx].value = nextValue;
  } else {
    fields.push({ name: '🎥 Bewijs', value: nextValue || 'Geen bewijs geüpload' });
  }
  embed.setFields(fields);

  await editMessageWithRetry(
    voteMessage,
    { embeds: [embed] },
    'Evidence embed update',
    { userId: authorId }
  );
};

const sendEvidenceFiles = async ({ message, pendingType, pending, incidentData, voteChannel }) => {
  const attachments = [...message.attachments.values()];
  const files = [];
  for (const attachment of attachments) {
    const buffer = await downloadAttachment(attachment.url);
    files.push({ attachment: buffer, name: attachment.name || 'bewijs' });
  }
  if (files.length === 0) return;

  const raceLabel =
    pendingType === 'appeal'
      ? `Incident ${pending.incidentNumber || 'Onbekend'}`
      : incidentData
        ? `${incidentData.incidentNumber} - ${incidentData.raceName} (${incidentData.round})`
        : 'Onbekend incident';
  await voteChannel.send({
    content:
      pendingType === 'appeal'
        ? `📎 Bewijsmateriaal wederwoord van ${message.author.tag}`
        : `📎 Bewijsmateriaal van ${message.author.tag}`,
    files
  });
};

const resolvePendingGuiltyEntry = async ({ message, pendingByUser, store }) => {
  const incidentFromMessage = extractIncidentNumberFromText(message.content || '');
  let incidentKey = incidentFromMessage;
  let pendingEntry = incidentKey ? pendingByUser?.[incidentKey] : null;
  const entries = pendingByUser ? Object.entries(pendingByUser) : [];

  if (!pendingEntry) {
    if (entries.length === 1) {
      const entry = entries[0];
      incidentKey = entry?.[0] || null;
      pendingEntry = entry?.[1] || null;
    } else if (entries.length > 1) {
      await message.reply(
        '❌ Meerdere incidenten open. Vermeld het incidentnummer (bijv. INC-1234) in je reactie.'
      );
      return null;
    }
  }

  if (!pendingEntry) return null;

  if (!incidentKey) {
    incidentKey = (pendingEntry.incidentNumber || '').toUpperCase() || null;
  }

  if (pendingEntry.channelId && pendingEntry.channelId !== message.channelId) return null;

  if (Date.now() > pendingEntry.expiresAt) {
    if (incidentKey) {
      await store.deletePendingGuiltyReply(message.author.id, incidentKey);
    }
    await message.reply('⏳ Reactietermijn verlopen. Neem contact op met de stewards.');
    return null;
  }

  return { incidentKey, pendingEntry };
};

const sendGuiltyReplyToStewards = async ({
  message,
  pendingEntry,
  incidentKey,
  voteChannel,
  stewardRoleId,
  incidentData
}) => {
  const responseText = (message.content || '').trim();
  const sanitizedResponseText = responseText.replace(/INC-\d+/gi, '').replace(/\s{2,}/g, ' ').trim();
  const attachmentLinks = [...message.attachments.values()].map((a) => a.url);
  if (!sanitizedResponseText && attachmentLinks.length === 0) {
    await message.reply('❌ Stuur een reactie of voeg een bijlage toe.');
    return false;
  }

  const authorId = message.author.id;
  const isReporter = incidentData?.reporterId && incidentData.reporterId === authorId;
  const isGuilty = incidentData?.guiltyId && incidentData.guiltyId === authorId;
  const responseColor = isReporter ? '#2ECC71' : isGuilty ? '#E67E22' : '#F1C40F';
  const responseRoleLabel = isReporter ? 'Indiener' : isGuilty ? 'Tegenpartij' : null;

  const roleTag = responseRoleLabel ? ` (${responseRoleLabel})` : '';
  const responseEmbed = new EmbedBuilder()
    .setColor(responseColor)
    .setTitle(
      `🗣️ Reactie${roleTag} ${message.author.tag} - ${
        pendingEntry.incidentNumber || incidentKey || 'Onbekend'
      }`
    )
    .setDescription(
      [sanitizedResponseText || '*Geen tekst meegeleverd.*', ...attachmentLinks].filter(Boolean).join('\n')
    )
    .setTimestamp();

  await voteChannel.send({
    content: `<@&${stewardRoleId}> - Reactie <@${message.author.id}> ontvangen voor incident ${
      pendingEntry.incidentNumber || incidentKey || 'Onbekend'
    }`,
    embeds: [responseEmbed]
  });

  return true;
};

const finalizeGuiltyReply = async ({ message, store, incidentKey, pendingEntry }) => {
  await message.reply(
    `✅ Je reactie is doorgestuurd naar de stewards voor incident **${
      pendingEntry.incidentNumber || incidentKey || 'Onbekend'
    }**.`
  );
};

const scheduleDeletionBundle = (client, delayMs, messages) => {
  for (const msg of messages) {
    if (!msg) continue;
    scheduleMessageDeletion(client, delayMs, msg.id, msg.channelId);
  }
};

const isAllowedEvidenceUrl = (url) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be' ||
      host === 'twitch.tv' ||
      host.endsWith('.twitch.tv')
    );
  } catch {
    return false;
  }
};

function registerMessageHandlers(client, { config, state }) {
  const { store, autoDeleteMs } = state;
  const incidentChatChannelId = config.incidentChatChannelId;
  const allowedGuildId = config.allowedGuildId;
  const addEvidence = new AddEvidence();

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!allowedGuildId) return;
    if (message.guildId && message.guildId !== allowedGuildId) return;

    const urls = extractUrls(message.content);
    const allowedUrls = urls.filter(isAllowedEvidenceUrl);
    const hasEvidencePayload = message.attachments.size > 0 || allowedUrls.length > 0;

    const pendingByUser = await store.getPendingGuiltyRepliesByUser(message.author.id);
    if (!message.guildId && pendingByUser) {
      const resolved = await resolvePendingGuiltyEntry({
        message,
        pendingByUser,
        store
      });
      if (resolved) {
        const { incidentKey, pendingEntry } = resolved;
        const voteChannel = await fetchTextTargetChannel(client, pendingEntry.threadId || config.voteChannelId);
        if (!voteChannel) {
          await message.reply('❌ Steward-kanaal niet gevonden. Probeer later opnieuw.');
          return;
        }

        const sent = await sendGuiltyReplyToStewards({
          message,
          pendingEntry,
          incidentKey,
          voteChannel,
          stewardRoleId: config.stewardRoleId
        });
        if (!sent) return;

        await finalizeGuiltyReply({
          message,
          store,
          incidentKey,
          pendingEntry
        });
        return;
      }
    }

    if (!message.guildId) {
      const ticketInput = extractIncidentNumberFromText(message.content || '');
      let normalizedTicket = normalizeTicketInput(ticketInput);
      const pendingForEvidence = await store.getPendingEvidence(message.author.id);
      const isEvidenceFlow =
        hasEvidencePayload &&
        pendingForEvidence &&
        pendingForEvidence.channelId === message.channelId;
      if (!normalizedTicket) {
        if (!isEvidenceFlow) {
          await message.reply(
            '❌ Incidentnummer ontbreekt. Stuur je reactie met het incidentnummer, bijvoorbeeld:\n' +
              '`INC-1234 Mijn verhaal over het incident...`'
          );
          return;
        }
        if (pendingForEvidence?.type === 'appeal') {
          await message.reply(
            '❌ Voeg het incidentnummer toe om extra bewijs te delen, bijvoorbeeld:\n' +
              '`INC-1234 Extra beelden/links voor mijn wederwoord`'
          );
          return;
        }
      }

      const allowEvidenceWithoutTicket = pendingForEvidence?.type === 'incident';
      const treatAsEvidence =
        isEvidenceFlow && (allowEvidenceWithoutTicket || normalizedTicket);

      if (treatAsEvidence) {
        // Evidence uploads within the 10-minute window should not be forced into the reply flow.
        normalizedTicket = '';
      }

      if (!normalizedTicket) {
        // No reply flow; evidence flow below will handle attachments/links.
      } else {
      const found = await findIncidentMessageByNumber(client, config, normalizedTicket);
      if (!found?.message) {
        await message.reply('❌ Incidentnummer niet gevonden. Controleer of het klopt.');
        return;
      }

      const incidentData = hydrateIncidentFromMessage(found.message);
      if (!incidentData) {
        await message.reply('❌ Incidentgegevens niet gevonden. Neem contact op met de stewards.');
        return;
      }

      const allowed =
        (incidentData.guiltyId && incidentData.guiltyId === message.author.id) ||
        (incidentData.reporterId && incidentData.reporterId === message.author.id);
      if (!allowed) {
        await message.reply('❌ Alleen de melder of de schuldige rijder kan op dit incident reageren.');
        return;
      }

      const createdAt = found.message.createdTimestamp || found.message.createdAt?.getTime?.();
      if (createdAt && Date.now() - createdAt > guiltyReplyWindowMs) {
        await message.reply('⏳ Reactietermijn verlopen. Neem contact op met de stewards.');
        return;
      }

      const voteChannel = await fetchTextTargetChannel(client, found.threadId || config.voteChannelId);
      if (!voteChannel) {
        await message.reply('❌ Steward-kanaal niet gevonden. Probeer later opnieuw.');
        return;
      }

      const pendingEntry = {
        incidentNumber: incidentData.incidentNumber || normalizedTicket,
        raceName: incidentData.raceName,
        round: incidentData.round,
        reporterTag: incidentData.reporter,
        messageId: found.message.id,
        threadId: found.threadId,
        channelId: message.channelId,
        expiresAt: createdAt ? createdAt + guiltyReplyWindowMs : Date.now() + guiltyReplyWindowMs
      };

      const sent = await sendGuiltyReplyToStewards({
        message,
        pendingEntry,
        incidentKey: normalizedTicket,
        voteChannel,
        stewardRoleId: config.stewardRoleId,
        incidentData
      });
      if (!sent) return;

      await message.reply(
        `✅ Je reactie is doorgestuurd naar de stewards voor incident **${pendingEntry.incidentNumber}**.`
      );
      return;
      }
    }

    if (incidentChatChannelId && message.mentions.has(client.user) && message.channelId !== incidentChatChannelId) {
      const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
      const cleanedContent = (message.content || '').replace(mentionRegex, '').trim();
      const incidentChannel = await client.channels.fetch(incidentChatChannelId).catch(() => null);
      if (incidentChannel?.isTextBased()) {
        const attachmentLinks = [...message.attachments.values()].map((a) => a.url);
        const messageLink = message.guildId
          ? `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`
          : null;
        const locationLabel = message.guildId ? `<#${message.channelId}>` : 'DM';
        const forwardedEmbed = new EmbedBuilder()
          .setColor('#1ABC9C')
          .setTitle('📨 Nieuw bericht voor Race Incident Bot')
          .setDescription(
            [
              `Afzender: **${message.author.tag}**`,
              `Locatie: ${locationLabel}`,
              messageLink ? `Bericht: ${messageLink}` : null,
              '',
              cleanedContent ? cleanedContent : '*Geen tekst meegeleverd.*'
            ]
              .filter(Boolean)
              .join('\n')
          )
          .setTimestamp();

        if (attachmentLinks.length > 0) {
          forwardedEmbed.addFields({
            name: '📎 Bijlagen',
            value: attachmentLinks.join('\n')
          });
        }

        await incidentChannel.send({
          embeds: [forwardedEmbed],
          allowedMentions: { parse: [] }
        });
      }

      const confirmationText = '✅ Je bericht is privé doorgestuurd naar #incident-chat.';
      try {
        await message.author.send({ content: confirmationText });
      } catch {}

      await safeDelete(message);
    }

    const pending = await store.getPendingEvidence(message.author.id);
    const pendingType = pending?.type || 'incident';
    const evidenceCheck = await addEvidence.execute({
      pending,
      now: Date.now(),
      channelId: message.channelId,
      hasEvidencePayload
    });
    if (evidenceCheck.status === 'skip') return;
    if (evidenceCheck.status === 'expired') {
      await store.deletePendingEvidence(message.author.id);
      return;
    }

    const voteChannel = await fetchTextTargetChannel(
      client,
      pending.voteThreadId || config.voteChannelId
    );
    if (!voteChannel) return;

    const voteMessage = await voteChannel.messages.fetch(pending.messageId).catch(() => null);
    if (!voteMessage) return;

    const attachmentLinks = [...message.attachments.values()].map((a) => a.url);
    const evidenceLinks = [...attachmentLinks, ...allowedUrls];
    const evidenceText = evidenceLinks.join('\n');
    const evidenceItems = [
      ...attachmentLinks.map((url) => ({
        type: 'attachment',
        url,
        addedBy: message.author.id,
        addedAt: Date.now()
      })),
      ...allowedUrls.map((url) => ({
        type: 'link',
        url,
        addedBy: message.author.id,
        addedAt: Date.now()
      }))
    ];
    try {
      await updateEvidenceEmbed({
        voteMessage,
        evidenceText,
        authorId: message.author?.id
      });
    } catch {}
    try {
      await store.appendEvidence(pending.messageId, evidenceItems);
    } catch (err) {
      console.error('Evidence store update failed:', err);
    }
    try {
      const incidentData = await store.getIncident(pending.messageId);
      await sendEvidenceFiles({
        message,
        pendingType,
        pending,
        incidentData,
        voteChannel
      });
    } catch (err) {
      console.error('Bewijs uploaden mislukt:', err);
    }
    const incidentLabel = await buildIncidentLabel(pending, store);
    const confirmation = await message.reply(
      `✅ Bewijsmateriaal toegevoegd aan incident-ticket ${incidentLabel}.`
    );
    if (pending.promptMessageId) {
      const oldPrompt = await message.channel.messages.fetch(pending.promptMessageId).catch(() => null);
      await safeDelete(oldPrompt);
    }
    const prompt = await message.reply({
      content: 'Wil je nog meer beelden uploaden of links delen?',
      components: [buildEvidencePromptRow(pendingType)]
    });
    scheduleDeletionBundle(client, autoDeleteMs, [message, confirmation, prompt]);
    const botMessageIds = [
      ...(pending.botMessageIds || []),
      confirmation?.id,
      prompt?.id
    ].filter(Boolean);
    if (prompt?.id) {
      await store.setPendingEvidence(message.author.id, {
        ...pending,
        expiresAt: Date.now() + evidenceWindowMs,
        promptMessageId: prompt.id,
        botMessageIds
      });
    } else {
      await store.setPendingEvidence(message.author.id, {
        ...pending,
        expiresAt: Date.now() + evidenceWindowMs,
        botMessageIds
      });
    }
  });
}

module.exports = { registerMessageHandlers };
