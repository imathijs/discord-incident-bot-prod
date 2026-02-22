const { DomainError } = require('../../domain/errors/DomainError');

class CreateIncident {
  constructor({ incidentRepository, notificationPort, workflowState, clock, idGenerator }) {
    this.incidentRepository = incidentRepository;
    this.notificationPort = notificationPort;
    this.workflowState = workflowState;
    this.clock = clock;
    this.idGenerator = idGenerator;
  }

  formatSheetTimestamp(date) {
    const pad2 = (value) => String(value).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    return `${year}-${month}-${day} - ${hours}:${minutes}`;
  }

  async execute({
    pending,
    stewardNote,
    evidenceWindowMs,
    guiltyReplyWindowMs,
    fallbackEvidenceChannelId,
    evidenceUserId,
    pendingOwnerId
  }) {
    const raceName = pending?.raceName;
    const round = pending?.round;
    const description = pending?.description;
    if (!raceName || !round || !description) {
      throw new DomainError('Missing incident fields', 'MISSING_FIELDS');
    }

    const division = pending?.division || 'Onbekend';
    const corner = pending?.corner || '';
    const reasonLabel = pending?.reasonLabel || pending?.reasonValue || 'Onbekend';
    const incidentNumber = pending?.incidentNumber || (await this.idGenerator.nextIncidentNumber());

    const reporterTag = pending?.reporterTag || 'Onbekend';
    const guiltyDriver = pending?.guiltyTag || 'Onbekend';

    const { threadId, messageId } = await this.notificationPort.createIncidentThread({
      incidentNumber,
      division,
      raceName,
      round,
      corner,
      description,
      reasonLabel,
      guiltyId: pending?.guiltyId,
      guiltyTag: pending?.guiltyTag,
      reporterId: pending?.reporterId,
      reporterTag,
      stewardNote
    });

    const sheetRow = [
      'New',
      this.formatSheetTimestamp(new Date(this.clock.now())),
      division,
      guiltyDriver,
      reporterTag,
      raceName,
      round,
      corner || '',
      reasonLabel,
      description,
      ''
    ];

    const incident = {
      id: messageId,
      incidentNumber,
      division,
      raceName,
      round,
      corner,
      guiltyId: pending?.guiltyId,
      guiltyDriver,
      reason: reasonLabel,
      reporter: reporterTag,
      reporterId: pending?.reporterId,
      votes: {},
      threadId,
      status: 'OPEN',
      createdAt: this.clock.now(),
      evidence: []
    };

    const saved = await this.incidentRepository.save({ incident, sheetRow });

    if (saved?.sheetRowNumber) {
      await this.notificationPort.addSheetFooter({
        threadId,
        messageId,
        sheetRowNumber: saved.sheetRowNumber
      });
    }

    if (pending?.guiltyId) {
      try {
        const reporterMention = pending?.reporterId
          ? `<@${pending.reporterId}>`
          : `**${reporterTag}**`;
        const dmText =
          'Er is een race incident ingediend door ' +
          `${reporterMention} met het incident nummer **${incidentNumber}**.\n` +
          `Het gaat om Race ${raceName} * Ronde ${round}.\n` +
          'Je hebt 2 dagen de tijd om te reageren door middel van deze DM te gebruiken.\n' +
          'De DM mag slechts één keer worden ingediend en wordt als tegenpartij als reactie geplaatst onder het incident-ticket.';
        const dmInfo = await this.notificationPort.sendGuiltyDm({
          guiltyId: pending.guiltyId,
          content: dmText
        });
        if (dmInfo?.channelId) {
          const normalizedIncident = incidentNumber.toUpperCase();
          await this.workflowState.setPendingGuiltyReply(pending.guiltyId, normalizedIncident, {
            incidentNumber,
            raceName,
            round,
            reporterTag,
            messageId,
            threadId,
            channelId: dmInfo.channelId,
            expiresAt: this.clock.now() + guiltyReplyWindowMs,
            responded: false
          });
        }
      } catch {}
    }

    let evidenceChannelId = fallbackEvidenceChannelId;
    let botMessageIds = [];
    let promptMessageId = null;
    if (evidenceUserId) {
      try {
        const dmInfo = await this.notificationPort.sendReporterEvidenceDm({
          reporterId: evidenceUserId,
          content:
            `✅ Je incident-ticket **${incidentNumber}** is verzonden naar de stewards.\n` +
            `Upload of stuur een link van je bewijsmateriaal in deze DM binnen 10 minuten om het automatisch toe te voegen aan je melding.\n` +
            'Is je video groter dan 10MB? Klik op **Grote video uploaden**.'
        });
        if (dmInfo?.channelId) {
          evidenceChannelId = dmInfo.channelId;
          botMessageIds = dmInfo.botMessageIds || [];
          promptMessageId = dmInfo.promptMessageId || null;
        }
      } catch {}
    }

    await this.workflowState.setPendingEvidence(evidenceUserId, {
      messageId,
      voteThreadId: threadId,
      channelId: evidenceChannelId,
      expiresAt: this.clock.now() + evidenceWindowMs,
      type: 'incident',
      incidentNumber,
      botMessageIds,
      promptMessageId
    });

    if (pendingOwnerId) {
      await this.workflowState.clearPendingIncidentReport(pendingOwnerId);
    }

    return { incidentNumber };
  }
}

module.exports = { CreateIncident };
