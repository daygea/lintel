'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

/**
 * Each test file starts its OWN in-memory mongod. Simple and robust: no
 * cross-process coordination, so there is nothing to get wrong under parallelism.
 * A short start-retry absorbs the transient "failed to start in 10s" that a loaded
 * laptop can throw; pair it with a capped fork pool (vitest.config.js) so only a
 * few servers boot at once. On a very busy machine, VITEST_MAX_FORKS=1 runs the
 * files one at a time — slowest, but it cannot contend.
 */
async function startMongo(attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await MongoMemoryServer.create();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

beforeAll(async () => {
  mongod = await startMongo();
  await mongoose.connect(mongod.getUri());

  // Build every model's indexes against this file's fresh server. syncIndexes (not
  // createIndexes) reconciles with the tenant-guard plugin's tenantId index instead
  // of colliding on it. Sequential — a cold server chokes on concurrent builds.
  // Inherits the generous hookTimeout from vitest.config.js.
  const models = require('../src/models');
  for (const Model of Object.values(models)) {
    if (typeof Model.syncIndexes === 'function') await Model.syncIndexes();
  }
});

afterEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  // Guard: a failed start leaves mongod undefined; don't mask the real error.
  if (mongod) await mongod.stop();
});
