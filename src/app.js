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

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);

  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: mongoUri }),
      cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 12 },
    })
  );

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
