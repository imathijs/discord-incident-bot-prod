const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { evidenceButtonIds } = require('../../constants');

function buildEvidencePromptRow(type = 'incident') {
  const doneLabel = type === 'appeal' ? 'Voltooi wederwoord' : 'Voltooi incident';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(evidenceButtonIds.more).setLabel('Meer beelden uploaden').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(evidenceButtonIds.externalUpload)
      .setLabel('Grote video uploaden')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(evidenceButtonIds.done).setLabel(doneLabel).setStyle(ButtonStyle.Success)
  );
}

module.exports = { buildEvidencePromptRow };
