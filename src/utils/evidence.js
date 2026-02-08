const https = require('node:https');

function scheduleMessageDeletion(client, autoDeleteMs, messageId, channelId) {
  if (!autoDeleteMs) return;
  setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.messages.delete(messageId).catch(() => {});
    } catch {}
  }, autoDeleteMs);
}

function downloadAttachment(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

module.exports = {
  scheduleMessageDeletion,
  downloadAttachment
};
