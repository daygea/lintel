'use strict';

require('dotenv').config();

const REQUIRED = ['MONGODB_URI', 'SESSION_SECRET', 'ROOT_DOMAIN'];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length && process.env.NODE_ENV !== 'test') {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill it in.');
  process.exit(1);
}

if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  rootDomain: process.env.ROOT_DOMAIN || 'lintel.test',
  mongoUri: process.env.MONGODB_URI || '',
  sessionSecret: process.env.SESSION_SECRET || 'test-secret-test-secret-test-secret',
  logLevel: process.env.LOG_LEVEL || 'info',
};
