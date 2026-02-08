/**
 * IncidentRepository port (interface contract).
 * Implementations live in infrastructure/persistence.
 */
class IncidentRepository {
  async getById() {
    throw new Error('Not implemented');
  }

  async save() {
    throw new Error('Not implemented');
  }

  async listOpen() {
    throw new Error('Not implemented');
  }

  async nextCounter() {
    throw new Error('Not implemented');
  }
}

module.exports = { IncidentRepository };
