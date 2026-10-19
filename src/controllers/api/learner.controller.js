'use strict';

const learner = require('../../services/learner.service');
const deadlines = require('../../services/deadlines.service');
const gradebook = require('../../services/gradebook.service');
const push = require('../../services/push.service');
const auth = require('../../services/auth.service');

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
    learnerName: req.user && req.user.name,
    help: require('../../config/help').learner,
    helpCategories: require('../../config/help').categories.learner,
  })
);

// Author preview — ungated, no access log. The route is author-gated.
exports.preview = h(async (req, res) =>
  res.json(await learner.previewLessonFor({
    lessonId: req.params.lessonId,
    userId: req.user._id,
    locale: req.tenant.defaultLocale,
  }))
);

exports.deadlines = h(async (req, res) =>
  res.json({ deadlines: await deadlines.upcomingFor({ userId: req.user._id, locale: req.tenant.defaultLocale }) })
);

exports.grades = h(async (req, res) =>
  res.json(await gradebook.learnerGrades(req.user._id, req.tenant.defaultLocale))
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

// Learner self-service profile (the PWA profile view).
exports.profile = h(async (req, res) =>
  res.json({
    name: req.user.name,
    email: req.user.email,
    phone: req.user.phone || '',
    displayName: (req.membership && req.membership.displayName) || null,
    csrfToken: req.session.csrfToken,
  })
);

exports.updateProfile = h(async (req, res) => {
  const user = await auth.updateProfile({ userId: req.user._id, name: req.body.name, phone: req.body.phone });
  res.json({ ok: true, name: user.name, phone: user.phone || '' });
});

exports.changePassword = h(async (req, res) => {
  if (req.body.newPassword !== req.body.confirm) {
    return res.status(422).json({ error: 'The new passwords do not match.' });
  }
  const result = await auth.changePassword({
    userId: req.user._id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
  });
  // Keep THIS session valid after the epoch bump (see the web profile controller).
  if (req.session && result && result.sessionEpoch != null) req.session.epoch = result.sessionEpoch;
  res.json({ ok: true });
});

exports.pushKey = h(async (_req, res) => res.json({ publicKey: push.publicKey() }));
exports.pushSubscribe = h(async (req, res) => {
  await push.subscribe(req.body, req.get('user-agent'));
  res.status(201).json({ ok: true });
});
