jest.mock('../src/utils/channels', () => ({
  fetchTextTargetChannel: jest.fn()
}));

const { fetchTextTargetChannel } = require('../src/utils/channels');
const { registerMessageHandlers } = require('../src/infrastructure/discord/message');

describe('message handler - DM incident replies', () => {
  test('rejects DM reply with incident number when user is neither reporter nor guilty', async () => {
    const incidentNumber = 'INC-2026109';
    const reporterId = '111111111111111111';
    const guiltyId = '222222222222222222';
    const unauthorizedUserId = '333333333333333333';

    const starterMessage = {
      id: 'starter-msg-1',
      embeds: [
        {
          title: `Incident ${incidentNumber}`,
          fields: [
            { name: '🔢 Incidentnummer', value: incidentNumber },
            { name: '⚠️ Schuldige rijder', value: `<@${guiltyId}>` },
            { name: '👤 Ingediend door', value: `<@${reporterId}>` },
            { name: '🏁 Race', value: 'Race 3' },
            { name: '🔢 Ronde', value: '65' }
          ]
        }
      ],
      createdTimestamp: Date.now()
    };

    const thread = {
      id: 'thread-1',
      name: `${incidentNumber} - Test incident`,
      fetchStarterMessage: jest.fn().mockResolvedValue(starterMessage)
    };
    const forumChannel = {
      id: 'forum-1',
      threads: {
        fetchActive: jest.fn().mockResolvedValue({ threads: new Map([[thread.id, thread]]) }),
        fetchArchived: jest.fn().mockResolvedValue({ threads: new Map() })
      }
    };
    fetchTextTargetChannel.mockResolvedValue(forumChannel);

    const client = {
      user: { id: 'bot-1' },
      handlers: {},
      on(event, handler) {
        this.handlers[event] = handler;
      }
    };

    const store = {
      getPendingGuiltyRepliesByUser: jest.fn().mockResolvedValue({
        [incidentNumber]: {
          incidentNumber,
          threadId: 'old-thread-id',
          channelId: 'dm-channel-1',
          expiresAt: Date.now() + 60_000
        }
      }),
      deletePendingGuiltyReply: jest.fn(),
      getPendingEvidence: jest.fn().mockResolvedValue(null)
    };

    registerMessageHandlers(client, {
      config: {
        voteChannelId: 'forum-1',
        stewardRoleId: 'role-1',
        incidentChatChannelId: 'incident-chat-1',
        allowedGuildId: 'guild-1'
      },
      state: {
        store,
        autoDeleteMs: 1000
      }
    });

    const reply = jest.fn().mockResolvedValue({ id: 'reply-1' });
    const dmMessage = {
      author: { id: unauthorizedUserId, bot: false, tag: 'unauth#0001' },
      guildId: null,
      channelId: 'dm-channel-1',
      channel: { messages: { fetch: jest.fn() } },
      content: `${incidentNumber} Dit is mijn reactie`,
      attachments: new Map(),
      mentions: { has: jest.fn().mockReturnValue(false) },
      reply
    };

    await client.handlers.messageCreate(dmMessage);

    expect(reply).toHaveBeenCalledWith('❌ Alleen de melder of de schuldige rijder kan op dit incident reageren.');
  });
});
