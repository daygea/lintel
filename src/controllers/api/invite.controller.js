'use strict';

const invite = require('../../services/invite.service');

exports.invite = async (req, res, next) => {
  try {
    const { user, membership } = await invite.inviteMember({
      email: req.body.email,
      name: req.body.name,
      role: req.body.role,
      invitedByUserId: req.user._id,
    });
    res.status(201).json({ user: { id: user._id, email: user.email }, membership });
  } catch (err) {
    next(err);
  }
};
