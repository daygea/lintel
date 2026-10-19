'use strict';

const auth = require('../../services/auth.service');
const { ValidationError } = require('../../lib/errors');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

exports.show = h(async (req, res) => {
  res.render('tenant/profile', {
    profileUser: req.user,
    saved: req.query.saved || null,
    pw: req.query.pw || null,
    error: req.query.err || null,
  });
});

exports.save = h(async (req, res) => {
  try {
    await auth.updateProfile({ userId: req.user._id, name: req.body.name, phone: req.body.phone });
    res.redirect('/settings/profile?saved=1');
  } catch (err) {
    res.redirect('/settings/profile?err=' + encodeURIComponent(err.message));
  }
});

exports.changePassword = h(async (req, res) => {
  try {
    if (req.body.newPassword !== req.body.confirm) {
      throw new ValidationError('The new passwords do not match.');
    }
    const result = await auth.changePassword({
      userId: req.user._id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    });
    // Changing the password bumps sessionEpoch (signs out every OTHER session).
    // Advance THIS session's epoch so the person who just changed it stays signed in.
    if (req.session && result && result.sessionEpoch != null) req.session.epoch = result.sessionEpoch;
    res.redirect('/settings/profile?pw=1');
  } catch (err) {
    res.redirect('/settings/profile?err=' + encodeURIComponent(err.message));
  }
});
