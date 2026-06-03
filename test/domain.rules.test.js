const { CastVote } = require('../src/application/usecases/CastVote');
const { RequestAccusedResponse } = require('../src/application/usecases/RequestAccusedResponse');
const { FinalizeIncident } = require('../src/application/usecases/FinalizeIncident');
const { CreateIncident } = require('../src/application/usecases/CreateIncident');
const { DomainError } = require('../src/domain/errors/DomainError');

describe('Domain rules', () => {
  test('involved steward cannot vote', async () => {
    const castVote = new CastVote();
    const incidentData = {
      reporterId: 'user-1',
      guiltyId: 'user-2',
      votes: {}
    };

    let thrown = null;
    try {
      await castVote.execute({
        incidentData,
        voterId: 'user-1',
        action: 'validate'
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown.code).toBe('VOTER_INVOLVED');
  });

  test('accused response window within 48h', async () => {
    const requestAccusedResponse = new RequestAccusedResponse();
    const now = Date.now();
    const pending = {
      expiresAt: now - 1,
      allowedGuiltyId: 'user-2',
      incidentNumber: 'INC-1234'
    };

    let thrown = null;
    try {
      await requestAccusedResponse.execute({
        mode: 'submit',
        userId: 'user-2',
        pending,
        incidentNumberInput: 'INC-1234',
        now,
        evidenceWindowMs: 10 * 60 * 1000,
        voteThreadId: null,
        dmChannelId: 'dm-1',
        appealMessageId: 'msg-1'
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown.code).toBe('EXPIRED');
  });

  test('finalize determines outcome correctly', async () => {
    const finalizeIncident = new FinalizeIncident();
    const incidentData = {
      votes: {
        a: { category: 'cat2', plus: true, minus: false, reporterCategory: 'cat1', reporterPlus: false, reporterMinus: false },
        b: { category: 'cat2', plus: false, minus: false, reporterCategory: 'cat1', reporterPlus: true, reporterMinus: false },
        c: { category: 'cat1', plus: false, minus: false, reporterCategory: 'cat1', reporterPlus: false, reporterMinus: true }
      }
    };

    const result = await finalizeIncident.execute({ incidentData, finalText: 'Besluit tekst' });

    expect(result.decision).toBe('CAT2');
    expect(result.penaltyPoints).toBe(1);
    expect(result.reporterDecision).toBe('CAT1');
    expect(result.reporterPenaltyPoints).toBe(0);
    expect(result.finalTextValue).toBe('Besluit tekst');
  });

  test('finalize uses category override only on tied highest vote count', async () => {
    const finalizeIncident = new FinalizeIncident();
    const incidentData = {
      votes: {
        a: { category: 'cat2', plus: false, minus: false, reporterCategory: 'cat1', reporterPlus: false, reporterMinus: false },
        b: { category: 'cat3', plus: false, minus: false, reporterCategory: 'cat2', reporterPlus: false, reporterMinus: false },
        c: { category: 'cat2', plus: false, minus: false, reporterCategory: 'cat1', reporterPlus: false, reporterMinus: false },
        d: { category: 'cat3', plus: false, minus: false, reporterCategory: 'cat2', reporterPlus: false, reporterMinus: false }
      }
    };

    const result = await finalizeIncident.execute({
      incidentData,
      finalText: 'Besluit tekst',
      decisionOverrides: {
        guilty: 'CAT4',
        reporter: 'CAT5'
      }
    });

    expect(result.decision).toBe('CAT4');
    expect(result.reporterDecision).toBe('CAT5');
  });

  test('finalize ignores category override when there is a clear winner', async () => {
    const finalizeIncident = new FinalizeIncident();
    const incidentData = {
      votes: {
        a: { category: 'cat2', plus: false, minus: false, reporterCategory: 'cat1', reporterPlus: false, reporterMinus: false },
        b: { category: 'cat2', plus: false, minus: false, reporterCategory: 'cat1', reporterPlus: false, reporterMinus: false },
        c: { category: 'cat1', plus: false, minus: false, reporterCategory: 'cat3', reporterPlus: false, reporterMinus: false }
      }
    };

    const result = await finalizeIncident.execute({
      incidentData,
      finalText: 'Besluit tekst',
      decisionOverrides: {
        guilty: 'CAT4',
        reporter: 'CAT5'
      }
    });

    expect(result.decision).toBe('CAT2');
    expect(result.reporterDecision).toBe('CAT1');
  });

  test('create incident on behalf keeps submitter out of voting participants', async () => {
    const savedIncidents = [];
    const incidentRepository = {
      save: jest.fn(async ({ incident }) => {
        savedIncidents.push(incident);
        return incident;
      })
    };
    const notificationPort = {
      createIncidentThread: jest.fn().mockResolvedValue({ threadId: 'thread-1', messageId: 'msg-1' }),
      addSheetFooter: jest.fn(),
      sendGuiltyDm: jest.fn().mockResolvedValue({ channelId: 'dm-guilty' }),
      sendReporterEvidenceDm: jest.fn().mockResolvedValue({
        channelId: 'dm-reporter',
        botMessageIds: ['bot-msg-1'],
        promptMessageId: 'prompt-1'
      }),
      sendSubmitterConfirmationDm: jest.fn().mockResolvedValue({ channelId: 'dm-submitter' })
    };
    const workflowState = {
      setPendingGuiltyReply: jest.fn(),
      setPendingEvidence: jest.fn(),
      clearPendingIncidentReport: jest.fn()
    };
    const createIncident = new CreateIncident({
      incidentRepository,
      notificationPort,
      workflowState,
      clock: { now: () => 1000 },
      idGenerator: { nextIncidentNumber: jest.fn().mockResolvedValue('INC-1') }
    });

    await createIncident.execute({
      pending: {
        raceClass: 'GT3',
        division: 'Div 1',
        raceName: '3',
        round: '12',
        corner: 'Spa',
        description: 'Incident',
        reasonLabel: 'Contact',
        reporterId: 'user-b',
        reporterTag: 'driverB#0001',
        guiltyId: 'user-c',
        guiltyTag: 'driverC#0001',
        submitterId: 'user-a',
        submitterTag: 'driverA#0001'
      },
      evidenceWindowMs: 600000,
      guiltyReplyWindowMs: 172800000,
      fallbackEvidenceChannelId: 'report-channel',
      evidenceUserId: 'user-b',
      pendingOwnerId: 'user-a'
    });

    expect(savedIncidents[0]).toMatchObject({
      reporterId: 'user-b',
      guiltyId: 'user-c',
      submitterId: 'user-a'
    });
    expect(notificationPort.createIncidentThread).toHaveBeenCalledWith(expect.objectContaining({
      reporterId: 'user-b',
      guiltyId: 'user-c',
      submitterId: 'user-a'
    }));
    expect(notificationPort.sendReporterEvidenceDm).toHaveBeenCalledWith(expect.objectContaining({
      reporterId: 'user-b'
    }));
    expect(notificationPort.sendGuiltyDm).toHaveBeenCalledWith(expect.objectContaining({
      guiltyId: 'user-c'
    }));
    expect(notificationPort.sendSubmitterConfirmationDm).toHaveBeenCalledWith(expect.objectContaining({
      submitterId: 'user-a'
    }));
    expect(workflowState.setPendingEvidence).toHaveBeenCalledWith(
      'user-b',
      expect.objectContaining({ incidentNumber: 'INC-1' })
    );
  });
});
