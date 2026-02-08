class Evidence {
  constructor(props) {
    this.incidentNumber = props?.incidentNumber || null;
    this.authorId = props?.authorId || null;
    this.links = Array.isArray(props?.links) ? props.links : [];
    this.attachments = Array.isArray(props?.attachments) ? props.attachments : [];
    this.createdAt = props?.createdAt || null;
  }
}

module.exports = { Evidence };
