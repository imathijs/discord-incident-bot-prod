const { CastVote } = require('../src/application/usecases/CastVote');
const { RequestAccusedResponse } = require('../src/application/usecases/RequestAccusedResponse');
const { FinalizeIncident } = require('../src/application/usecases/FinalizeIncident');
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
});
