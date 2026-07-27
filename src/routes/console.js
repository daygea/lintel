'use strict';

const express = require('express');
const router = express.Router();

const { loadPlatformSession, requireSuperadmin } = require('../middleware/platform-auth');
const c = require('../controllers/web/console.controller');

/**
 * The platform console. Mounted on the apex, BEFORE the tenant resolver, so it
 * runs without a tenant. Every route requires a real superadmin session — no
 * URL secret. loadPlatformSession populates req.user; requireSuperadmin gates.
 */
router.use(loadPlatformSession);

// Login is reachable WITHOUT the superadmin gate (you can't be gated in before you
// authenticate). Everything else under /console requires a superadmin session.
router.get('/console/login', c.showLogin);
router.post('/console/login', c.login);
router.post('/console/logout', c.logout);

router.use('/console', requireSuperadmin);

router.get('/console', c.dashboard);
router.get('/console/institutions', c.institutions);
router.get('/console/institutions/:id', c.institution);
router.post('/console/institutions/:id/suspend', c.suspend);
router.post('/console/institutions/:id/reactivate', c.reactivate);
router.post('/console/institutions/:id/plan', c.setPlan);
router.post('/console/institutions/:id/edit', c.editInstitution);
router.post('/console/institutions/:id/close', c.closeInstitution);

router.get('/console/applications', c.applications);
router.post('/console/applications/:id/approve', c.approveApplication);
router.post('/console/applications/:id/decline', c.declineApplication);

router.get('/console/operators', c.operators);
router.post('/console/operators/grant', c.grantOperator);
router.post('/console/operators/:id/revoke', c.revokeOperator);

router.get('/console/audit', c.audit);

// Users — abuse response
router.post('/console/users/:id/suspend', c.suspendUser);
router.post('/console/users/:id/reactivate', c.reactivateUser);
router.post('/console/users/:id/force-logout', c.forceLogout);
router.post('/console/users/:id/reset-password', c.resetPassword);

// Abuse reports
router.get('/console/reports', c.reports);
router.get('/console/reports/:id', c.report);
router.post('/console/reports/:id/resolve', c.resolveReport);

// Break-glass — the only path to tenant content, time-boxed and notified
router.get('/console/breakglass', c.breakglass);
router.post('/console/breakglass', c.openBreakglass);
router.post('/console/breakglass/:id/revoke', c.revokeBreakglass);

module.exports = router;
