class DomainError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DomainError';
    this.code = code || 'DOMAIN_ERROR';
  }
}

module.exports = {
  DomainError
};
