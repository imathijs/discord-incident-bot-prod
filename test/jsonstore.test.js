const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { JsonStore } = require('../src/infrastructure/persistence/JsonStore');

const createTempStore = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dre-store-'));
  const store = new JsonStore({ dataDir: dir, initialCounter: 1000 });
  return { store, dir };
};

const removeDir = async (dir) => {
  if (!dir) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 2) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
};

describe('JsonStore concurrency', () => {
  test('nextIncidentNumber is unique under parallel calls', async () => {
    const { store, dir } = await createTempStore();
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => store.nextIncidentNumber())
      );
      const unique = new Set(results);
      expect(unique.size).toBe(20);
      expect(results.every((id) => id.startsWith('INC-'))).toBe(true);
    } finally {
      await removeDir(dir);
    }
  });

  test('parallel setVote preserves all votes', async () => {
    const { store, dir } = await createTempStore();
    try {
      const incidentId = 'msg-1';
      const voters = Array.from({ length: 10 }, (_, i) => `user-${i + 1}`);
      await Promise.all(
        voters.map((voterId) =>
          store.setVote(incidentId, voterId, {
            category: 'cat1',
            plus: false,
            minus: false,
            reporterCategory: null,
            reporterPlus: false,
            reporterMinus: false
          })
        )
      );
      const votes = await store.getVotes(incidentId);
      expect(Object.keys(votes)).toHaveLength(10);
    } finally {
      await removeDir(dir);
    }
  });

  test('listOpenIncidents excludes finalized and withdrawn', async () => {
    const { store, dir } = await createTempStore();
    try {
      await store.saveIncident({ id: 'a', incidentNumber: 'INC-1', status: 'OPEN' });
      await store.saveIncident({ id: 'b', incidentNumber: 'INC-2', status: 'FINALIZED' });
      await store.saveIncident({ id: 'c', incidentNumber: 'INC-3', status: 'WITHDRAWN' });
      const open = await store.listOpenIncidents({ withVotes: false });
      const ids = open.map((i) => i.id);
      expect(ids).toEqual(['a']);
    } finally {
      await removeDir(dir);
    }
  });
});
