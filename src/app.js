'use strict';

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const pinoHttp = require('pino-http');

const { sessionSecret, mongoUri, isProd } = require('./config/env');
const logger = require('./lib/logger');
const tenantResolver = require('./middleware/tenant-resolver');
const { loadSession } = require('./middleware/auth');
const csrf = require('./middleware/csrf');
const errorHandler = require('./middleware/error-handler');
const routes = require('./routes');
const { pick } = require('./plugins/locale-map');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);

  // `pick(localeMap, locale)` is a pure, request-independent view helper used by
  // 16 templates. It was passed per-render, so any render that forgot it made the
  // view throw `pick is not defined` (a 500). Registering it as an app-level local
  // means every view has it unconditionally — the omission can't recur. Per-render
  // `pick` in controllers still works (identical function; render locals just
  // shadow this one).
  app.locals.pick = pick;

  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(
    session({
      // A distinct cookie name so Lintel's session never collides with another app
      // on the same host (e.g. during local dev alongside other projects on
      // localhost). Without this, express-session's default 'connect.sid' can clash.
      name: 'lintel.sid',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: mongoUri }),
      cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 12 },
    })
  );

  // Liveness probe for the platform (Render health checks, uptime monitors).
  // Host-agnostic, no tenant context, no DB — just proves the process is serving.
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Platform console — apex-only, superadmin-gated, no tenant context. Mounted
  // above the resolver with CSRF (which is tenant-independent). Its own router
  // loads the platform session and enforces the superadmin gate.
  app.use(csrf, require('./routes/console'));

  // Public routes that must work WITHOUT a tenant context — a stranger scanning a
  // QR has no institution subdomain. These sit above the resolver deliberately.
  // CSRF is applied explicitly here (public forms POST too — signup, register,
  // set-password) rather than relying on the console mount above.
  app.use(csrf, require('./routes/public'));

  // Order matters. Nothing below this line may query tenant data before the
  // resolver has established a context.
  app.use(tenantResolver);
  app.use(loadSession);
  app.use(csrf);

  app.use(routes);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
