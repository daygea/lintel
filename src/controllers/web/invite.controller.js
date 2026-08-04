'use strict';

const invite = require('../../services/invite.service');

exports.showInvite = (req, res) => {
  res.render('tenant/invite', {
    roles: invite.INVITABLE,
    labels: invite.LABELS,
    sent: req.query.sent || null,
    error: null,
  });
};

exports.submitInvite = async (req, res, next) => {
  try {
    const { user } = await invite.inviteMember({
      email: req.body.email,
      name: req.body.name,
      role: req.body.role,
      invitedByUserId: req.user._id,
    });
    res.redirect(`/members/invite?sent=${encodeURIComponent(user.email)}`);
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      return res.status(422).render('tenant/invite', {
        roles: invite.INVITABLE,
        labels: invite.LABELS,
        sent: null,
        error: err.message,
      });
    }
    return next(err);
  }
};
