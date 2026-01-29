const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function editMessageWithRetry(message, payload, context, meta = {}) {
  if (!message) throw new Error('Message missing for edit');
  try {
    await message.edit(payload);
    return true;
  } catch (err) {
    console.error(`${context} failed (attempt 1)`, {
      messageId: message?.id,
      channelId: message?.channelId,
      error: err,
      ...meta
    });
    await sleep(800);
    try {
      await message.edit(payload);
      return true;
    } catch (err2) {
      console.error(`${context} failed (attempt 2)`, {
        messageId: message?.id,
        channelId: message?.channelId,
        error: err2,
        ...meta
      });
      throw err2;
    }
  }
}

module.exports = { editMessageWithRetry };
