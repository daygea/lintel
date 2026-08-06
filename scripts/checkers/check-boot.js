'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

/**
 * The app must actually LOAD.
 *
 * Text-scanning checkers and the unit tests never require app.js top-to-bottom,
 * so a route referencing a not-yet-declared guard (a temporal dead zone), a
 * typo'd controller, or a broken import passes every check and the whole suite —
 * then crashes on `npm run dev`. This boots app.js in a child process (no DB
 * connection happens at require time) with placeholder env and fails the build if
 * it throws, so a boot break can't reach a deploy.
 */
module.exports = function checkBoot() {
  const root = path.join(__dirname, '..', '..');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost/checkboot',
    SESSION_SECRET: process.env.SESSION_SECRET || 'x'.repeat(40),
    ROOT_DOMAIN: process.env.ROOT_DOMAIN || 'lintel.test',
    SUPERADMIN_EMAIL: process.env.SUPERADMIN_EMAIL || 'admin@lintel.test',
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || 'x',
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || 'x',
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || 'x',
    R2_BUCKET: process.env.R2_BUCKET || 'x',
  };
  const script =
    "process.on('unhandledRejection', () => {});" +
    "require('./src/app.js').createApp();" + // builds the full app: all routers, guards, mounts
    "process.exit(0);"; // exit before the lazy Mongo connection can reject on the dummy URL
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: root, env, encoding: 'utf8', timeout: 30000,
  });
  if (res.status === 0) return [];
  const msg = (res.stderr || res.stdout || 'unknown error').trim().split('\n').slice(0, 8).join('\n');
  return [`app.js failed to load — this is what boots on \`npm run dev\` / in production:\n    ${msg.replace(/\n/g, '\n    ')}`];
};
