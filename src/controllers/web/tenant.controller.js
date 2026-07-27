'use strict';

const membershipService = require('../../services/membership.service');
const { has, STAFF } = require('../../lib/roles');

exports.dashboard = async (req, res, next) => {
  try {
    // The institution root dispatches by standing. An active learner belongs in
    // the learner app, not the admin shell — otherwise reaching '/' (by direct
    // navigation, or being redirected here after sign-in) fails the staff role
    // gate with "you do not have permission". Only staff see the admin dashboard.
    if (!has(req.membership, ...STAFF)) return res.redirect('/app/');
    const members = await membershipService.list();
    res.render('tenant/dashboard', { members });
  } catch (err) {
    next(err);
  }
};

exports.admit = async (req, res, next) => {
  try {
    await membershipService.activate(req.params.id, req.user._id);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
};
