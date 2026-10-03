'use strict';

const auth = require('../../services/auth.service');

exports.login = async (req, res, next) => {
  try {
    const user = await auth.authenticate(req.body);
    // Regenerate the session before establishing identity — defeats session fixation.
    await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.userId = user._id.toString();
    req.session.epoch = user.sessionEpoch || 0;
    res.json({ user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => req.session.destroy(() => res.json({ ok: true }));
