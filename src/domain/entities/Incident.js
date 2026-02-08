class Incident {
  constructor(props) {
    this.id = props?.id || null;
    this.incidentNumber = props?.incidentNumber || null;
    this.status = props?.status || 'open';
    this.division = props?.division || null;
    this.raceName = props?.raceName || null;
    this.round = props?.round || null;
    this.corner = props?.corner || null;
    this.reason = props?.reason || null;
    this.description = props?.description || null;
    this.reporterId = props?.reporterId || null;
    this.reporterTag = props?.reporterTag || null;
    this.guiltyId = props?.guiltyId || null;
    this.guiltyTag = props?.guiltyTag || null;
    this.votes = props?.votes || {};
    this.createdAt = props?.createdAt || null;
    this.sheetRowNumber = props?.sheetRowNumber || null;
    this.threadId = props?.threadId || null;
  }
}

module.exports = { Incident };
