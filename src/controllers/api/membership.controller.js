'use strict';

const membershipService = require('../../services/membership.service');

exports.list = async (req, res, next) => {
  try {
    const members = await membershipService.list();
    res.json({ members });
  } catch (err) {
    next(err);
  }
};

exports.setRoles = async (req, res, next) => {
  try {
    const membership = await membershipService.setRoles({
      membershipId: req.params.id,
      roles: req.body.roles,
      actorUserId: req.user._id,
    });
    res.json({ membership });
  } catch (err) {
    next(err);
  }
};
