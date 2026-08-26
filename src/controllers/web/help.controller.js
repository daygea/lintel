'use strict';

const help = require('../../config/help');

/**
 * Role-aware staff help. A topic shows when it targets no specific role
 * (everyone) or targets one of the member's roles.
 */
exports.show = (req, res) => {
  const roles = (req.membership && req.membership.roles) || [];
  const topics = help.staff.filter(
    (t) => !t.roles || !t.roles.length || t.roles.some((r) => roles.includes(r))
  );
  res.render('tenant/help', { topics });
};
