'use strict';

const membershipService = require('../../services/membership.service');

exports.dashboard = async (req, res, next) => {
  try {
    const members = await membershipService.list();
    res.render('tenant/dashboard', { members });
  } catch (err) {
    next(err);
  }
};
