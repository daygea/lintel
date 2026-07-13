'use strict';

const express = require('express');
const webAuth = require('../controllers/web/auth.controller');
const apiAuth = require('../controllers/api/auth.controller');
const webTenant = require('../controllers/web/tenant.controller');
const apiMembership = require('../controllers/api/membership.controller');
const { requireUser, requireMember, requireRole } = require('../middleware/auth');
const { ROLES } = require('../lib/roles');

const router = express.Router();

router.get('/healthz', (_req, res) => res.json({ ok: true }));

router.get('/login', webAuth.showLogin);
router.post('/login', webAuth.login);
router.post('/logout', webAuth.logout);

router.post('/api/v1/auth/login', apiAuth.login);
router.post('/api/v1/auth/logout', apiAuth.logout);

router.get(
  '/api/v1/members',
  requireUser,
  requireMember,
  requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.REGISTRAR),
  apiMembership.list
);
router.patch(
  '/api/v1/members/:id/roles',
  requireUser,
  requireMember,
  requireRole(ROLES.OWNER, ROLES.ADMIN),
  apiMembership.setRoles
);

router.get(
  '/',
  requireUser,
  requireMember,
  requireRole(ROLES.OWNER, ROLES.ADMIN, ROLES.REGISTRAR),
  webTenant.dashboard
);

module.exports = router;
