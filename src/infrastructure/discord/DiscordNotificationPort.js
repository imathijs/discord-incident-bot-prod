const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { fetchTextTargetChannel } = require('../../utils/channels');
const { editMessageWithRetry } = require('../../utils/messages');
const { buildEvidencePromptRow } = require('./evidenceUI');
const IDS = require('../../ids');

class DiscordNotificationPort {
  constructor({ client, config }) {
    this.client = client;
    this.config = config;
  }

  buildIncidentThreadName({ incidentNumber, reporterTag, guiltyDriver, status = 'open' }) {
    const statusPrefix = status === 'resolved' ? '✅' : '⚠️';
    const reporter = reporterTag || 'Onbekend';
    const guilty = guiltyDriver || 'Onbekend';
    const base = `${statusPrefix} ${incidentNumber} - ${reporter} vs ${guilty}`;
    if (base.length <= 100) return base;
    return `${base.slice(0, 97)}...`;
  }

  buildVoteRows() {
    const voteButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${IDS.VOTE_CAT_PREFIX}0`).setLabel('Cat 0').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.VOTE_CAT_PREFIX}1`).setLabel('Cat 1').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.VOTE_CAT_PREFIX}2`).setLabel('Cat 2').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.VOTE_CAT_PREFIX}3`).setLabel('Cat 3').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.VOTE_CAT_PREFIX}4`).setLabel('Cat 4').setStyle(ButtonStyle.Secondary)
    );

    const voteButtonsRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${IDS.VOTE_CAT_PREFIX}5`).setLabel('Cat 5').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(IDS.VOTE_PLUS).setLabel('+ Strafpunt').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(IDS.VOTE_MINUS).setLabel('- Strafpunt').setStyle(ButtonStyle.Primary)
    );

    return { voteButtons, voteButtonsRow2 };
  }

  buildReporterVoteRows({ guiltyDriver, reporterLabelName }) {
    const reporterSeparatorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sep_indiener')
        .setLabel(`⬆️ ${guiltyDriver} --- ${reporterLabelName} ⬇️`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    const reporterButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${IDS.VOTE_REPORTER_CAT_PREFIX}0`).setLabel('Cat 0').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.VOTE_REPORTER_CAT_PREFIX}1`).setLabel('Cat 1').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.VOTE_REPORTER_CAT_PREFIX}2`).setLabel('Cat 2').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.VOTE_REPORTER_CAT_PREFIX}3`).setLabel('Cat 3').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${IDS.VOTE_REPORTER_CAT_PREFIX}4`).setLabel('Cat 4').setStyle(ButtonStyle.Secondary)
    );

    const reporterButtonsRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${IDS.VOTE_REPORTER_CAT_PREFIX}5`).setLabel('Cat 5').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(IDS.VOTE_REPORTER_PLUS).setLabel('+ Strafpunt').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(IDS.VOTE_REPORTER_MINUS).setLabel('- Strafpunt').setStyle(ButtonStyle.Primary)
    );

    return { reporterSeparatorRow, reporterButtons, reporterButtonsRow2 };
  }

  buildFinalizeCheatsheetEmbed() {
    const sections = [
      '**Categorie 0**',
      '- Race incident',
      '- Niet racen maar op de baan blijven',
      '- Expres leaven / rage quit',
      '- Respawnen in pits (kwalificatie)',
      '- Getunede auto / drivers agreement schenden',
      '- Onsportief gedrag (spookrijden, wallride, etc.)',
      '',
      '**Categorie 1**',
      '- Agressief aanvallen (zonder positie verlies)',
      '- Blauwe vlag negeren',
      '- Niet op omgeving letten',
      '- Herhaaldelijk aantikken',
      '- Penalty burnen op racelijn',
      '- Slechte aansluiting rollende start (>3 lengtes)',
      '',
      '**Categorie 2**',
      '- Agressief aanvallen / verdedigen',
      '- Van baan drukken / geen ruimte laten',
      '- Onveilig terugkomen op baan',
      '- Opzettelijk hinderen (kwalificatie)',
      '',
      '**Categorie 3**',
      '- Iemand van baan afrijden',
      '- Startprocedures niet naleven',
      '- Incident tijdens formatieronde',
      '- Ghosten > 2 ronden',
      '',
      '**Categorie 4**',
      '- Kettingbotsing veroorzaken',
      '- Expres iemand van baan rijden',
      '',
      '**Categorie 5**',
      '- Startincident verhoogd naar cat 5',
      '- Verbaal aanvallen / discriminatie'
    ];

    return new EmbedBuilder()
      .setColor('#8712ee')
      .setTitle('📚 Cheatsheet')
      .setDescription(sections.join('\n'));
  }

  buildIncidentEmbed({
    incidentNumber,
    division,
    raceName,
    round,
    corner,
    description,
    reasonLabel,
    guiltyDriver,
    reporterTag,
    guiltyMention,
    reporterMention,
    stewardNote
  }) {
    const fields = [
      { name: '👤 Ingediend door', value: reporterMention || 'Onbekend', inline: true },
      { name: '🏁 Divisie', value: division || 'Onbekend', inline: true },
      { name: '🏁 Race', value: raceName || 'Onbekend', inline: true },
      { name: '🔢 Ronde', value: round || 'Onbekend', inline: true },
      { name: '🏁 Circuit', value: corner || 'Onbekend', inline: true },
      { name: '⚠️ Schuldige rijder', value: guiltyMention || 'Onbekend', inline: true },
      { name: '📌 Reden', value: reasonLabel || 'Onbekend' },
      { name: '📝 Beschrijving', value: description || 'Onbekend' }
    ];
    if (stewardNote) fields.push({ name: '⚠️ Opmerking', value: stewardNote });
    fields.push(
      { name: '\u200b', value: '\u200b' },
      { name: '🎥 Bewijs', value: 'Zie uploads/links' },
      { name: '\u200b', value: '\u200b' },
      { name: `📊 Tussenstand - ${guiltyDriver || 'Onbekend'}`, value: 'Nog geen stemmen.' },
      { name: `📊 Tussenstand - ${reporterTag || 'Onbekend'}`, value: 'Nog geen stemmen.' },
      { name: `🗳️ Stemmen - ${guiltyDriver || 'Onbekend'}`, value: 'Nog geen stemmen.' },
      { name: `🗳️ Stemmen - ${reporterTag || 'Onbekend'}`, value: 'Nog geen stemmen.' }
    );

    return new EmbedBuilder()
      .setColor('#FF6B00')
      .setTitle(`🚨 Incident ${incidentNumber}`)
      .addFields(...fields)
      .setTimestamp();
  }

  async createIncidentThread(payload) {
    const forumChannel = await fetchTextTargetChannel(this.client, this.config.voteChannelId);
    if (!forumChannel?.threads?.create) {
      const err = new Error('Vote channel missing or not a forum');
      err.code = 'VOTE_CHANNEL_MISSING';
      throw err;
    }

    const {
      incidentNumber,
      division,
      raceName,
      round,
      corner,
      description,
      reasonLabel,
      guiltyId,
      guiltyTag,
      reporterId,
      reporterTag,
      stewardNote
    } = payload;

    const guiltyDriver = guiltyTag || 'Onbekend';
    const guiltyMention = guiltyId ? `<@${guiltyId}>` : guiltyDriver;
    const reporterMention = reporterId ? `<@${reporterId}>` : reporterTag || 'Onbekend';

    const maxLabelNameLength = 24;
    const truncateLabelName = (value) => {
      if (!value) return 'Onbekend';
      return value.length > maxLabelNameLength ? `${value.slice(0, maxLabelNameLength - 1)}…` : value;
    };
    const reporterLabelName = truncateLabelName(reporterTag);

    const incidentEmbed = this.buildIncidentEmbed({
      incidentNumber,
      division,
      raceName,
      round,
      corner,
      description,
      reasonLabel,
      guiltyDriver,
      reporterTag,
      guiltyMention,
      reporterMention,
      stewardNote
    });

    const { voteButtons, voteButtonsRow2 } = this.buildVoteRows();
    const { reporterSeparatorRow, reporterButtons, reporterButtonsRow2 } = this.buildReporterVoteRows({
      guiltyDriver,
      reporterLabelName
    });

    const threadName = this.buildIncidentThreadName({
      incidentNumber,
      reporterTag,
      guiltyDriver
    });

    let thread;
    try {
      thread = await forumChannel.threads.create({
        name: threadName,
        message: {
          content: `<@&${this.config.stewardRoleId}> - Incident ${incidentNumber} gemeld door ${reporterTag}`,
          embeds: [incidentEmbed],
          components: [voteButtons, voteButtonsRow2, reporterSeparatorRow, reporterButtons, reporterButtonsRow2]
        }
      });
    } catch (err) {
      console.warn('⚠️ Forum thread aanmaken mislukt.', {
        voteChannelId: this.config.voteChannelId,
        threadName,
        error: err?.message,
        code: err?.code,
        status: err?.status
      });
      throw err;
    }

    let message = await thread.fetchStarterMessage().catch(() => null);
    if (!message) {
      message = await thread.send({
        content: `<@&${this.config.stewardRoleId}> - Incident ${incidentNumber} gemeld - ${division} - ${raceName} (${round}) - Door ${reporterTag}`,
        embeds: [incidentEmbed],
        components: [voteButtons, voteButtonsRow2, reporterSeparatorRow, reporterButtons, reporterButtonsRow2]
      });
    }

    const finalizeButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(IDS.FINALIZE_VOTES).setLabel('Incident Afhandelen').setStyle(ButtonStyle.Primary)
    );
    await thread.send({
      embeds: [this.buildFinalizeCheatsheetEmbed()],
      components: [finalizeButtons]
    });

    return {
      threadId: thread.id,
      messageId: message.id,
      incidentEmbed
    };
  }

  async addSheetFooter({ threadId, messageId, sheetRowNumber }) {
    if (!sheetRowNumber) return false;
    const channel = await fetchTextTargetChannel(this.client, threadId);
    if (!channel?.messages?.fetch) return false;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return false;
    const baseEmbed = message.embeds?.[0];
    if (!baseEmbed) return false;
    const enrichedEmbed = EmbedBuilder.from(baseEmbed).setFooter({ text: `SheetRow:${sheetRowNumber}` });
    await editMessageWithRetry(
      message,
      { embeds: [enrichedEmbed], components: message.components },
      'Add sheet row footer',
      { messageId, channelId: channel.id }
    );
    return true;
  }

  async sendGuiltyDm({ guiltyId, content }) {
    const guiltyUser = await this.client.users.fetch(guiltyId).catch(() => null);
    if (!guiltyUser) return null;
    const guiltyDm = await guiltyUser.createDM();
    await guiltyDm.send(content);
    return { channelId: guiltyDm.id };
  }

  async sendReporterEvidenceDm({ reporterId, content }) {
    const reporterUser = await this.client.users.fetch(reporterId).catch(() => null);
    if (!reporterUser) return null;
    const dmChannel = await reporterUser.createDM();
    const dmIntro = await dmChannel.send({
      content,
      components: [buildEvidencePromptRow('incident')]
    });
    return { channelId: dmChannel.id, botMessageIds: [dmIntro.id], promptMessageId: dmIntro.id };
  }
}

module.exports = { DiscordNotificationPort };
