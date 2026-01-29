async function fetchTextTargetChannel(client, channelId) {
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;

  if (channel.isThread && channel.isThread()) {
    if (channel.archived) {
      await channel.setArchived(false).catch(() => null);
    }

    if (channel.joinable) {
      await channel.join().catch(() => null);
    }
  }

  return channel;
}

module.exports = { fetchTextTargetChannel };
