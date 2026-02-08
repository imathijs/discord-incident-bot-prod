/**
 * NotificationPort abstracts Discord (or other) delivery.
 */
class NotificationPort {
  async sendDM() {
    throw new Error('Not implemented');
  }

  async postThreadMessage() {
    throw new Error('Not implemented');
  }

  async updateMessage() {
    throw new Error('Not implemented');
  }
}

module.exports = { NotificationPort };
