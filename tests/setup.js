'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Build every model's indexes against THIS file's fresh server. Without it,
  // unique constraints are not enforced (Mongoose auto-builds in the background,
  // and a fast insert can beat the build) — so a uniqueness test could pass or
  // fail on a race. It must run per file, because each file gets its own mongod.
  //
  // syncIndexes (NOT createIndexes): it reconciles with the tenant-guard plugin's
  // existing tenantId index instead of colliding on it. Sequential, because a cold
  // in-memory server chokes on concurrent builds. This is why hookTimeout is 60s
  // in vitest.config.js — the honest cost of deterministic constraints. Mirrors
  // exactly what `npm run indexes` does in production.
  const models = require('../src/models');
  for (const Model of Object.values(models)) {
    if (typeof Model.syncIndexes === 'function') await Model.syncIndexes();
  }
}, 60000);

afterEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
