'use strict';
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
