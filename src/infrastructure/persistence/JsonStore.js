const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const lockfile = require('proper-lockfile');

const normalizeIncidentNumber = (value) => String(value || '').trim().toUpperCase();

class JsonStore {
  constructor({ dataDir, initialCounter }) {
    this.dataDir = dataDir;
    this.initialCounter = Number(initialCounter) || 2026000;
    this.paths = {
      incidents: path.join(this.dataDir, 'incidents.json'),
      votes: path.join(this.dataDir, 'votes.json'),
      counters: path.join(this.dataDir, 'counters.json'),
      audit: path.join(this.dataDir, 'audit.json')
    };
  }

  async ensureDataDir() {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  getDefaultIncidents() {
    return {
      incidents: {},
      byNumber: {},
      workflow: {
        pendingEvidence: {},
        pendingIncidentReports: {},
        pendingAppeals: {},
        pendingFinalizations: {},
        pendingGuiltyReplies: {},
        pendingWithdrawals: {}
      }
    };
  }

  getDefaultVotes() {
    return { votes: {} };
  }

  getDefaultCounters() {
    return { nextIncidentNumber: this.initialCounter };
  }

  getDefaultAudit() {
    return { events: [] };
  }

  async ensureFile(filePath, defaultData) {
    await this.ensureDataDir();
    try {
      await fs.access(filePath);
    } catch {
      await this.writeJsonAtomic(filePath, defaultData);
    }
  }

  async readJson(filePath, fallback) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return fallback ?? null;
    }
  }

  async writeJsonAtomic(filePath, data) {
    await this.ensureDataDir();
    const tmp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
    const payload = `${JSON.stringify(data, null, 2)}\n`;
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, filePath);
  }

  async withFileLock(filePath, defaultData, fn) {
    await this.ensureFile(filePath, defaultData);
    const release = await lockfile.lock(filePath, {
      retries: { retries: 20, factor: 1.3, minTimeout: 25, maxTimeout: 250, randomize: true },
      realpath: false
    });
    try {
      const data = await this.readJson(filePath, defaultData);
      const outcome = await fn(data);
      let nextData = data;
      let changed = true;
      let result = outcome;
      if (outcome && typeof outcome === 'object') {
        if (Object.prototype.hasOwnProperty.call(outcome, 'data')) nextData = outcome.data;
        if (Object.prototype.hasOwnProperty.call(outcome, 'changed')) changed = outcome.changed;
        if (Object.prototype.hasOwnProperty.call(outcome, 'result')) result = outcome.result;
      }
      if (changed) {
        await this.writeJsonAtomic(filePath, nextData);
      }
      return result;
    } finally {
      await release().catch(() => {});
    }
  }

  async readIncidents() {
    await this.ensureFile(this.paths.incidents, this.getDefaultIncidents());
    return this.readJson(this.paths.incidents, this.getDefaultIncidents());
  }

  async readVotes() {
    await this.ensureFile(this.paths.votes, this.getDefaultVotes());
    return this.readJson(this.paths.votes, this.getDefaultVotes());
  }

  async getIncident(id, { withVotes = true } = {}) {
    if (!id) return null;
    const data = await this.readIncidents();
    const incident = data.incidents[id] || null;
    if (!incident) return null;
    if (!withVotes) return incident;
    const votes = await this.getVotes(id);
    return { ...incident, votes };
  }

  async getIncidentByNumber(incidentNumber, { withVotes = true } = {}) {
    const normalized = normalizeIncidentNumber(incidentNumber);
    if (!normalized) return null;
    const data = await this.readIncidents();
    const id = data.byNumber[normalized];
    if (!id) return null;
    return this.getIncident(id, { withVotes });
  }

  async saveIncident(incident) {
    if (!incident?.id) return null;
    const normalized = normalizeIncidentNumber(incident.incidentNumber);
    const now = Date.now();
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      const existing = data.incidents[incident.id] || null;
      const createdAt = existing?.createdAt || incident.createdAt || now;
      const updated = {
        ...existing,
        ...incident,
        createdAt,
        updatedAt: now
      };
      data.incidents[incident.id] = updated;
      if (normalized) data.byNumber[normalized] = incident.id;
      return { result: updated };
    });
  }

  async deleteIncident(id) {
    if (!id) return false;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      const existing = data.incidents[id];
      if (!existing) return { changed: false, result: false };
      delete data.incidents[id];
      const normalized = normalizeIncidentNumber(existing.incidentNumber);
      if (normalized && data.byNumber[normalized] === id) delete data.byNumber[normalized];
      return { result: true };
    });
  }

  async listOpenIncidents({ withVotes = true } = {}) {
    const data = await this.readIncidents();
    const incidents = Object.values(data.incidents);
    const open = incidents.filter((incident) => {
      const status = String(incident?.status || 'OPEN').toUpperCase();
      return status !== 'FINALIZED' && status !== 'WITHDRAWN';
    });
    if (!withVotes) return open;
    const votesData = await this.readVotes();
    return open.map((incident) => ({
      ...incident,
      votes: votesData.votes[incident.id] || {}
    }));
  }

  async getVotes(incidentId) {
    if (!incidentId) return {};
    const data = await this.readVotes();
    return data.votes[incidentId] || {};
  }

  async setVote(incidentId, voterId, voteEntry) {
    if (!incidentId || !voterId) return null;
    return this.withFileLock(this.paths.votes, this.getDefaultVotes(), (data) => {
      if (!data.votes[incidentId]) data.votes[incidentId] = {};
      data.votes[incidentId][voterId] = voteEntry;
      return { result: data.votes[incidentId] };
    });
  }

  async setVotes(incidentId, votes) {
    if (!incidentId) return null;
    return this.withFileLock(this.paths.votes, this.getDefaultVotes(), (data) => {
      data.votes[incidentId] = votes || {};
      return { result: data.votes[incidentId] };
    });
  }

  async nextIncidentNumber() {
    return this.withFileLock(this.paths.counters, this.getDefaultCounters(), (data) => {
      const current = Number(data.nextIncidentNumber) || 2026000;
      const next = current + 1;
      data.nextIncidentNumber = next;
      return { result: `INC-${next}` };
    });
  }

  async appendAudit(event) {
    return this.withFileLock(this.paths.audit, this.getDefaultAudit(), (data) => {
      data.events.push(event);
      return { result: event };
    });
  }

  async appendEvidence(incidentId, evidenceItems) {
    if (!incidentId || !Array.isArray(evidenceItems) || evidenceItems.length === 0) return null;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      const incident = data.incidents[incidentId];
      if (!incident) return { changed: false, result: null };
      const existing = Array.isArray(incident.evidence) ? incident.evidence : [];
      incident.evidence = existing.concat(evidenceItems);
      incident.updatedAt = Date.now();
      data.incidents[incidentId] = incident;
      return { result: incident.evidence };
    });
  }

  async getPendingEvidence(userId) {
    if (!userId) return null;
    const data = await this.readIncidents();
    return data.workflow.pendingEvidence[userId] || null;
  }

  async setPendingEvidence(userId, payload) {
    if (!userId) return null;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      data.workflow.pendingEvidence[userId] = payload;
      return { result: payload };
    });
  }

  async deletePendingEvidence(userId) {
    if (!userId) return false;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      if (!data.workflow.pendingEvidence[userId]) return { changed: false, result: false };
      delete data.workflow.pendingEvidence[userId];
      return { result: true };
    });
  }

  async listPendingEvidenceEntries() {
    const data = await this.readIncidents();
    return Object.entries(data.workflow.pendingEvidence);
  }

  async getPendingIncidentReport(userId) {
    if (!userId) return null;
    const data = await this.readIncidents();
    return data.workflow.pendingIncidentReports[userId] || null;
  }

  async setPendingIncidentReport(userId, payload) {
    if (!userId) return null;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      data.workflow.pendingIncidentReports[userId] = payload;
      return { result: payload };
    });
  }

  async deletePendingIncidentReport(userId) {
    if (!userId) return false;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      if (!data.workflow.pendingIncidentReports[userId]) return { changed: false, result: false };
      delete data.workflow.pendingIncidentReports[userId];
      return { result: true };
    });
  }

  async getPendingAppeal(userId) {
    if (!userId) return null;
    const data = await this.readIncidents();
    return data.workflow.pendingAppeals[userId] || null;
  }

  async setPendingAppeal(userId, payload) {
    if (!userId) return null;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      data.workflow.pendingAppeals[userId] = payload;
      return { result: payload };
    });
  }

  async deletePendingAppeal(userId) {
    if (!userId) return false;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      if (!data.workflow.pendingAppeals[userId]) return { changed: false, result: false };
      delete data.workflow.pendingAppeals[userId];
      return { result: true };
    });
  }

  async getPendingFinalization(userId) {
    if (!userId) return null;
    const data = await this.readIncidents();
    return data.workflow.pendingFinalizations[userId] || null;
  }

  async setPendingFinalization(userId, payload) {
    if (!userId) return null;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      data.workflow.pendingFinalizations[userId] = payload;
      return { result: payload };
    });
  }

  async deletePendingFinalization(userId) {
    if (!userId) return false;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      if (!data.workflow.pendingFinalizations[userId]) return { changed: false, result: false };
      delete data.workflow.pendingFinalizations[userId];
      return { result: true };
    });
  }

  async getPendingWithdrawal(userId) {
    if (!userId) return null;
    const data = await this.readIncidents();
    return data.workflow.pendingWithdrawals[userId] || null;
  }

  async setPendingWithdrawal(userId, payload) {
    if (!userId) return null;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      data.workflow.pendingWithdrawals[userId] = payload;
      return { result: payload };
    });
  }

  async deletePendingWithdrawal(userId) {
    if (!userId) return false;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      if (!data.workflow.pendingWithdrawals[userId]) return { changed: false, result: false };
      delete data.workflow.pendingWithdrawals[userId];
      return { result: true };
    });
  }

  async getPendingGuiltyRepliesByUser(userId) {
    if (!userId) return null;
    const data = await this.readIncidents();
    return data.workflow.pendingGuiltyReplies[userId] || null;
  }

  async setPendingGuiltyReply(userId, incidentKey, payload) {
    if (!userId || !incidentKey) return null;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      const existing = data.workflow.pendingGuiltyReplies[userId] || {};
      existing[incidentKey] = payload;
      data.workflow.pendingGuiltyReplies[userId] = existing;
      return { result: payload };
    });
  }

  async deletePendingGuiltyReply(userId, incidentKey) {
    if (!userId || !incidentKey) return false;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      const existing = data.workflow.pendingGuiltyReplies[userId];
      if (!existing || !existing[incidentKey]) return { changed: false, result: false };
      delete existing[incidentKey];
      if (Object.keys(existing).length === 0) {
        delete data.workflow.pendingGuiltyReplies[userId];
      } else {
        data.workflow.pendingGuiltyReplies[userId] = existing;
      }
      return { result: true };
    });
  }

  async deletePendingGuiltyRepliesByIncident(incidentNumber) {
    const normalized = normalizeIncidentNumber(incidentNumber);
    if (!normalized) return 0;
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      let removed = 0;
      const byUser = data.workflow.pendingGuiltyReplies;
      for (const [userId, entries] of Object.entries(byUser)) {
        if (!entries || !entries[normalized]) continue;
        delete entries[normalized];
        removed += 1;
        if (Object.keys(entries).length === 0) {
          delete byUser[userId];
        } else {
          byUser[userId] = entries;
        }
      }
      return { result: removed, changed: removed > 0 };
    });
  }

  async cleanupExpiredPending(now = Date.now()) {
    return this.withFileLock(this.paths.incidents, this.getDefaultIncidents(), (data) => {
      let removed = 0;
      const cleanupMap = (map) => {
        for (const [key, value] of Object.entries(map)) {
          if (value?.expiresAt && now > value.expiresAt) {
            delete map[key];
            removed += 1;
          }
        }
      };

      cleanupMap(data.workflow.pendingEvidence);
      cleanupMap(data.workflow.pendingIncidentReports);
      cleanupMap(data.workflow.pendingAppeals);
      cleanupMap(data.workflow.pendingFinalizations);
      cleanupMap(data.workflow.pendingWithdrawals);

      const guiltyReplies = data.workflow.pendingGuiltyReplies;
      for (const [userId, entries] of Object.entries(guiltyReplies)) {
        for (const [incidentKey, entry] of Object.entries(entries || {})) {
          if (entry?.expiresAt && now > entry.expiresAt) {
            delete entries[incidentKey];
            removed += 1;
          }
        }
        if (entries && Object.keys(entries).length === 0) {
          delete guiltyReplies[userId];
        }
      }

      return { result: removed, changed: removed > 0 };
    });
  }
}

module.exports = { JsonStore, normalizeIncidentNumber };
