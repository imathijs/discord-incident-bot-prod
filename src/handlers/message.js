const { EmbedBuilder } = require('discord.js');
const { evidenceWindowMs } = require('../constants');
const { buildEvidencePromptRow, downloadAttachment, scheduleMessageDeletion } = require('../utils/evidence');

const extractUrls = (content = '') => {
  const matches = content.match(/https?:\/\/\S+/gi) || [];
  return matches
    .map((url) => url.replace(/[),.;:]+$/g, ''))
    .filter(Boolean);
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
  const { pendingEvidence, activeIncidents, autoDeleteMs } = state;
  const incidentChatChannelId = config.incidentChatChannelId;

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (
      incidentChatChannelId &&
      message.mentions.has(client.user) &&
      message.channelId !== incidentChatChannelId
    ) {
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

      if (message.deletable) {
        await message.delete().catch(() => {});
      }
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

    const voteChannel = await client.channels.fetch(config.voteChannelId).catch(() => null);
    if (!voteChannel) return;

    const voteMessage = await voteChannel.messages.fetch(pending.messageId).catch(() => null);
    if (!voteMessage) return;

    const attachmentLinks = [...message.attachments.values()].map((a) => a.url);
    const evidenceLinks = [...attachmentLinks, ...allowedUrls];
    const evidenceText = evidenceLinks.join('\n');
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
      content: 'Wil je nog meer beelden uploaden of links delen?',
      components: [buildEvidencePromptRow(pendingType)]
    });
    scheduleMessageDeletion(client, autoDeleteMs, message.id, message.channelId);
    scheduleMessageDeletion(client, autoDeleteMs, confirmation.id, confirmation.channelId);
    scheduleMessageDeletion(client, autoDeleteMs, prompt.id, prompt.channelId);
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
