'use strict';

const learner = require('../../services/learner.service');
const push = require('../../services/push.service');

const req2ctx = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  sessionId: req.sessionID,
  userName: req.user?.name,
});

const h = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

exports.myLearning = h(async (req, res) =>
  res.json({
    ...(await learner.myLearning({ userId: req.user._id, locale: req.tenant.defaultLocale })),
    // The PWA ships with an empty csrf meta; hand it the session token so it can
    // make its one POST (marking a lesson complete). Same token double-submit
    // guard as the rest of the app.
    csrfToken: req.session.csrfToken,
    institution: req.tenant.name,
  })
);

exports.lesson = h(async (req, res) =>
  res.json({
    ...(await learner.lessonFor({
      lessonId: req.params.lessonId,
      userId: req.user._id,
      locale: req.tenant.defaultLocale,
      request: req2ctx(req),
    })),
    csrfToken: req.session.csrfToken,
  })
);

exports.pack = h(async (req, res) =>
  res.json(await learner.packFor({
    lessonId: req.params.lessonId,
    userId: req.user._id,
    locale: req.tenant.defaultLocale,
    request: req2ctx(req),
  }))
);

exports.pushKey = h(async (_req, res) => res.json({ publicKey: push.publicKey() }));
exports.pushSubscribe = h(async (req, res) => {
  await push.subscribe(req.body, req.get('user-agent'));
  res.status(201).json({ ok: true });
});
