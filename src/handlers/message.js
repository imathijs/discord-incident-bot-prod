const { EmbedBuilder } = require('discord.js');
const { evidenceWindowMs } = require('../constants');
const { buildEvidencePromptRow, downloadAttachment, scheduleMessageDeletion } = require('../utils/evidence');
const { fetchTextTargetChannel } = require('../utils/channels');
const { editMessageWithRetry } = require('../utils/messages');

const extractUrls = (content = '') => {
  const matches = content.match(/https?:\/\/\S+/gi) || [];
  return matches
    .map((url) => url.replace(/[),.;:]+$/g, ''))
    .filter(Boolean);
};

const extractIncidentNumber = (content = '') => {
  const match = content.match(/INC-\d+/i);
  return match ? match[0].toUpperCase() : null;
};

const safeDelete = async (msg) => {
  if (msg?.deletable) await msg.delete().catch(() => {});
};

const buildIncidentLabel = (pending, activeIncidents) =>
  pending.incidentNumber || activeIncidents.get(pending.messageId)?.incidentNumber || 'Onbekend';

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
        ? `📎 Bewijsmateriaal wederwoord van ${message.author.tag} - ${raceLabel}`
        : `📎 Bewijsmateriaal van ${message.author.tag} - ${raceLabel}`,
    files
  });
};

const resolvePendingGuiltyEntry = async ({ message, pendingByUser, pendingGuiltyReplies }) => {
  const incidentFromMessage = extractIncidentNumber(message.content || '');
  let incidentKey = incidentFromMessage;
  let pendingEntry = incidentKey ? pendingByUser.get(incidentKey) : null;

  if (!pendingEntry) {
    if (pendingByUser.size === 1) {
      const entry = pendingByUser.entries().next().value;
      incidentKey = entry?.[0] || null;
      pendingEntry = entry?.[1] || null;
    } else if (pendingByUser.size > 1) {
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
    pendingByUser.delete(incidentKey);
    if (pendingByUser.size === 0) pendingGuiltyReplies.delete(message.author.id);
    await message.reply('⏳ Reactietermijn verlopen. Neem contact op met de stewards.');
    return null;
  }

  if (pendingEntry.responded) {
    await message.reply(
      `✅ Je reactie voor incident **${pendingEntry.incidentNumber || incidentKey}** is al ontvangen.`
    );
    return null;
  }

  return { incidentKey, pendingEntry };
};

const sendGuiltyReplyToStewards = async ({
  message,
  pendingEntry,
  incidentKey,
  voteChannel
}) => {
  const responseText = (message.content || '').trim();
  const attachmentLinks = [...message.attachments.values()].map((a) => a.url);
  if (!responseText && attachmentLinks.length === 0) {
    await message.reply('❌ Stuur een reactie of voeg een bijlage toe.');
    return false;
  }

  const responseEmbed = new EmbedBuilder()
    .setColor('#F1C40F')
    .setTitle(`🗣️ Reactie tegenpartij - ${pendingEntry.incidentNumber || incidentKey || 'Onbekend'}`)
    .addFields(
      {
        name: '🔢 Incidentnummer',
        value: pendingEntry.incidentNumber || incidentKey || 'Onbekend',
        inline: true
      },
      { name: '👤 Tegenpartij', value: message.author.tag, inline: true },
      { name: '👤 Ingediend door', value: pendingEntry.reporterTag || 'Onbekend', inline: true },
      { name: '🏁 Race', value: pendingEntry.raceName || 'Onbekend', inline: true },
      { name: '🔢 Ronde', value: pendingEntry.round || 'Onbekend', inline: true },
      { name: '📝 Reactie', value: responseText || '*Geen tekst meegeleverd.*' }
    )
    .setTimestamp();

  if (attachmentLinks.length > 0) {
    responseEmbed.addFields({
      name: '📎 Bijlagen',
      value: attachmentLinks.join('\n')
    });
  }

  await voteChannel.send({
    content: `<@&${config.stewardRoleId}> - Reactie tegenpartij ontvangen voor incident ${
      pendingEntry.incidentNumber || incidentKey || 'Onbekend'
    }`,
    embeds: [responseEmbed]
  });

  return true;
};

const finalizeGuiltyReply = async ({ message, pendingByUser, pendingGuiltyReplies, incidentKey, pendingEntry }) => {
  pendingEntry.responded = true;
  pendingEntry.respondedAt = Date.now();
  pendingByUser.set(incidentKey, pendingEntry);
  pendingGuiltyReplies.set(message.author.id, pendingByUser);

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
  const { pendingEvidence, activeIncidents, pendingGuiltyReplies, autoDeleteMs } = state;
  const incidentChatChannelId = config.incidentChatChannelId;
  const allowedGuildId = config.allowedGuildId;

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guildId && allowedGuildId && message.guildId !== allowedGuildId) return;

    const pendingByUser = pendingGuiltyReplies.get(message.author.id);
    if (!message.guildId && pendingByUser && typeof pendingByUser.get === 'function') {
      const resolved = await resolvePendingGuiltyEntry({
        message,
        pendingByUser,
        pendingGuiltyReplies
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
          voteChannel
        });
        if (!sent) return;

        await finalizeGuiltyReply({
          message,
          pendingByUser,
          pendingGuiltyReplies,
          incidentKey,
          pendingEntry
        });
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

    const urls = extractUrls(message.content);
    const allowedUrls = urls.filter(isAllowedEvidenceUrl);
    if (message.attachments.size === 0 && allowedUrls.length === 0) return;

    const pending = pendingEvidence.get(message.author.id);
    if (!pending) return;
    const pendingType = pending.type || 'incident';
    if (pending.channelId !== message.channelId) return;
    if (Date.now() > pending.expiresAt) {
      pendingEvidence.delete(message.author.id);
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
    try {
      await updateEvidenceEmbed({
        voteMessage,
        evidenceText,
        authorId: message.author?.id
      });
    } catch {}
    try {
      const incidentData = activeIncidents.get(pending.messageId);
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
    const incidentLabel = buildIncidentLabel(pending, activeIncidents);
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
      pendingEvidence.set(message.author.id, {
        ...pending,
        expiresAt: Date.now() + evidenceWindowMs,
        promptMessageId: prompt.id,
        botMessageIds
      });
    } else {
      pendingEvidence.set(message.author.id, {
        ...pending,
        expiresAt: Date.now() + evidenceWindowMs,
        botMessageIds
      });
    }
  });
}

module.exports = { registerMessageHandlers };
