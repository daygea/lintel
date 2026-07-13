'use strict';

const auth = require('../../services/auth.service');

exports.login = async (req, res, next) => {
  try {
    const user = await auth.authenticate(req.body);
    req.session.userId = user._id.toString();
    res.json({ user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => req.session.destroy(() => res.json({ ok: true }));
