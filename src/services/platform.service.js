'use strict';

const { Tenant, User, Membership, PlatformAuditLog, TenantApplication, AbuseReport, BreakglassGrant } = require('../models');
const { Course, Lesson, ContentBlock, Asset } = require('../models');
const storage = require('../lib/storage');
const { runAsPlatform, currentUserId } = require('../lib/context');
const { ValidationError } = require('../lib/errors');
const { PLANS } = require('../config/plans');
const { runWithTenant } = require('../lib/context');
const { issueOnboarding } = require('./onboarding.service');
const { notify } = require('./notification');

/**
 * Every operation here runs as platform and writes a PlatformAuditLog entry. The
 * console manages the SYSTEM — institutions, plans, applications, operators — and
 * tenant METADATA. It never reads the contents of a tenant (lessons, records);
 * that boundary is deliberate and keeps an operator from silently browsing a
 * sacred-studies institution's restricted material.
 */

function audit(action, subjectType, subjectId, meta) {
  return PlatformAuditLog.create({
    actorUserId: currentUserId() || null,
    action, subjectType, subjectId, meta,
  });
}

/* ---- Overview -------------------------------------------------------------- */

async function overview() {
  return runAsPlatform('platform overview', async () => {
    const [tenants, users, pendingApps, superadmins] = await Promise.all([
      Tenant.countDocuments({ status: { $nin: ['closed', 'deleted'] } }).exec(),
      User.countDocuments({}).exec(),
      TenantApplication.countDocuments({ status: 'pending' }).exec(),
      User.countDocuments({ platformRole: 'superadmin' }).exec(),
    ]);
    const byStatus = await Tenant.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    return { tenants, users, pendingApps, superadmins, byStatus };
  });
}

/* ---- Institutions ---------------------------------------------------------- */

const listTenants = ({ includeArchived = false } = {}) =>
  runAsPlatform('list tenants', () =>
    Tenant.find(includeArchived ? {} : { status: { $nin: ['closed', 'deleted'] } })
      .sort({ createdAt: -1 })
      .limit(500)
      .exec()
  );

async function tenantDetail(tenantId) {
  return runAsPlatform('tenant detail', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');
    // Metadata only — membership COUNT, never the members' data.
    const memberCount = await Membership.countDocuments({ tenantId: tenant._id }).exec();
    return { tenant, memberCount };
  });
}

async function suspendTenant(tenantId, reason, actingUserId) {
  return runAsPlatform('suspend tenant', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');
    if (tenant.status === 'closed') throw new ValidationError('A closed institution cannot be suspended.');
    await Tenant.updateOne({ _id: tenant._id }, { status: 'suspended' }).exec();
    await audit('tenant.suspended', 'Tenant', tenant._id, { reason, from: tenant.status });
    return { ok: true };
  }, actingUserId);
}

async function reactivateTenant(tenantId, actingUserId) {
  return runAsPlatform('reactivate tenant', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');
    if (tenant.status !== 'suspended') throw new ValidationError('Only a suspended institution can be reactivated.');
    // Reactivating returns a tenant to 'active' (a trial that was suspended resumes as active).
    await Tenant.updateOne({ _id: tenant._id }, { status: 'active' }).exec();
    await audit('tenant.reactivated', 'Tenant', tenant._id, {});
    return { ok: true };
  }, actingUserId);
}

async function setPlan(tenantId, plan, actingUserId) {
  if (!PLANS[plan]) throw new ValidationError(`Unknown plan: ${plan}`);
  return runAsPlatform('set plan', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');
    await Tenant.updateOne(
      { _id: tenant._id },
      { plan, features: PLANS[plan].features }
    ).exec();
    await audit('tenant.plan_changed', 'Tenant', tenant._id, { from: tenant.plan, to: plan });
    return { ok: true };
  }, actingUserId);
}

/* ---- Operators ------------------------------------------------------------- */

const listSuperadmins = () =>
  runAsPlatform('list superadmins', () => User.find({ platformRole: 'superadmin' }).sort({ email: 1 }).exec());

async function grantSuperadmin(email, actingUserId) {
  return runAsPlatform('grant superadmin', async () => {
    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).exec();
    if (!user) throw new ValidationError('No user with that email. They must have an account first.');
    if (user.platformRole === 'superadmin') return { ok: true, already: true };
    await User.updateOne({ _id: user._id }, { platformRole: 'superadmin' }).exec();
    await audit('superadmin.granted', 'User', user._id, { email: user.email });
    return { ok: true };
  }, actingUserId);
}

async function revokeSuperadmin(userId, actingUserId) {
  return runAsPlatform('revoke superadmin', async () => {
    const actingId = currentUserId();
    if (String(actingId) === String(userId)) {
      throw new ValidationError('You cannot revoke your own superadmin access.');
    }
    const remaining = await User.countDocuments({ platformRole: 'superadmin' }).exec();
    if (remaining <= 1) throw new ValidationError('Cannot revoke the last superadmin.');
    const user = await User.findById(userId).exec();
    if (!user) throw new ValidationError('No such user');
    await User.updateOne({ _id: user._id }, { $unset: { platformRole: 1 } }).exec();
    await audit('superadmin.revoked', 'User', user._id, { email: user.email });
    return { ok: true };
  }, actingUserId);
}

/**
 * Edit an institution's METADATA — name, locales, and (carefully) its slug. This
 * is system-level configuration an operator legitimately owns; it is NOT editing
 * the institution's teaching or its public voice. Slug changes are logged loudly
 * because they move where everyone signs in.
 */
async function editTenantMetadata(tenantId, { name, locales, slug }, actingUserId) {
  return runAsPlatform('edit tenant metadata', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');
    const update = {};
    if (name && name !== tenant.name) update.name = name;
    if (locales && locales.length) { update.locales = locales; update.defaultLocale = locales[0]; }
    if (slug && slug !== tenant.slug) {
      const clash = await Tenant.findOne({ slug, _id: { $ne: tenant._id } }).exec();
      if (clash) throw new ValidationError('That address is already taken.');
      update.slug = String(slug).toLowerCase();
    }
    if (!Object.keys(update).length) return { ok: true, unchanged: true };
    await Tenant.updateOne({ _id: tenant._id }, update).exec();
    await audit('tenant.metadata_edited', 'Tenant', tenant._id, { changed: Object.keys(update), slugFrom: update.slug ? tenant.slug : undefined });
    return { ok: true };
  }, actingUserId);
}

/**
 * Close an institution — the end of its lifecycle (offboarding, a lapsed trial, a
 * confirmed deletion request). Distinct from suspend: suspend is reversible and
 * operational; close is terminal. A closed tenant is excluded from all listings
 * and its people cannot sign in. We do NOT hard-delete data here — closing is the
 * decision; any actual data destruction is a separate, deliberate, logged step so
 * a mistaken close is recoverable.
 */
async function closeTenant(tenantId, reason, actingUserId) {
  return runAsPlatform('close tenant', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');
    if (tenant.status === 'closed') throw new ValidationError('Already closed.');
    await Tenant.updateOne({ _id: tenant._id }, { status: 'closed' }).exec();
    await audit('tenant.closed', 'Tenant', tenant._id, { reason, from: tenant.status });
    return { ok: true };
  }, actingUserId);
}

/**
 * Soft-delete: hide the institution from the console entirely and stop its
 * subdomain resolving. Data is retained (append-only history is never destroyed),
 * so a delete is reversible via restoreTenant. Distinct from close, which keeps
 * the institution on the books as a former customer.
 */
async function deleteTenant(tenantId, reason, actingUserId) {
  return runAsPlatform('delete tenant', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');
    if (tenant.status === 'deleted') throw new ValidationError('Already deleted.');
    await Tenant.updateOne({ _id: tenant._id }, { status: 'deleted', deletedAt: new Date() }).exec();
    await audit('tenant.deleted', 'Tenant', tenant._id, { reason, from: tenant.status });
    return { ok: true };
  }, actingUserId);
}

/** Bring a soft-deleted institution back as suspended, so it's re-enabled only by an explicit reactivation. */
async function restoreTenant(tenantId, actingUserId) {
  return runAsPlatform('restore tenant', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');
    if (tenant.status !== 'deleted') throw new ValidationError('Only a deleted institution can be restored.');
    await Tenant.updateOne({ _id: tenant._id }, { status: 'suspended', deletedAt: null }).exec();
    await audit('tenant.restored', 'Tenant', tenant._id, {});
    return { ok: true };
  }, actingUserId);
}

/* ---- Users (abuse response) ----------------------------------------------- */

async function suspendUser(userId, reason, actingUserId) {
  return runAsPlatform('suspend user', async () => {
    const user = await User.findById(userId).exec();
    if (!user) throw new ValidationError('No such user');
    // Suspending also invalidates existing sessions (see forceLogout).
    await User.updateOne({ _id: user._id }, { status: 'suspended', $inc: { sessionEpoch: 1 } }).exec();
    await audit('user.suspended', 'User', user._id, { reason, email: user.email });
    return { ok: true };
  }, actingUserId);
}

async function reactivateUser(userId, actingUserId) {
  return runAsPlatform('reactivate user', async () => {
    const user = await User.findById(userId).exec();
    if (!user) throw new ValidationError('No such user');
    await User.updateOne({ _id: user._id }, { status: 'active' }).exec();
    await audit('user.reactivated', 'User', user._id, { email: user.email });
    return { ok: true };
  }, actingUserId);
}

/** Invalidate every existing session for a user (compromised/abusive account). */
async function forceLogout(userId, actingUserId) {
  return runAsPlatform('force logout', async () => {
    const user = await User.findById(userId).exec();
    if (!user) throw new ValidationError('No such user');
    await User.updateOne({ _id: user._id }, { $inc: { sessionEpoch: 1 } }).exec();
    await audit('user.force_logout', 'User', user._id, { email: user.email });
    return { ok: true };
  }, actingUserId);
}

/**
 * Send a password-reset LINK (never a password) to a user — same secure token
 * machinery as onboarding. Also forces logout, since a reset implies the current
 * credential is untrusted.
 */
async function sendPasswordReset(userId, actingUserId) {
  return runAsPlatform('send password reset', async () => {
    const user = await User.findById(userId).exec();
    if (!user) throw new ValidationError('No such user');
    await User.updateOne({ _id: user._id }, { $inc: { sessionEpoch: 1 } }).exec();
    const { link } = await issueOnboarding({ userId: user._id, purpose: 'reset_password' });
    await notify({
      userId: user._id,
      template: 'account_created',
      channels: ['email'],
      data: { institutionName: null, roleLabel: null, setPasswordUrl: link, expiresInHours: 48, tempPassword: null },
    });
    await audit('user.password_reset_sent', 'User', user._id, { email: user.email });
    return { ok: true };
  }, actingUserId);
}

/* ---- Abuse reports --------------------------------------------------------- */

/** File a report. Callable by anyone — reporter may be anonymous. */
function fileReport({ tenantId, subjectType, subjectId, subjectRef, category, detail, reportedByUserId, reporterEmail }) {
  return runAsPlatform('file abuse report', () =>
    AbuseReport.create({ tenantId, subjectType, subjectId, subjectRef, category, detail, reportedByUserId, reporterEmail })
  );
}

const listReports = (status = 'open') =>
  runAsPlatform('list abuse reports', () =>
    AbuseReport.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).exec()
  );

const reportDetail = (id) =>
  runAsPlatform('abuse report detail', () => AbuseReport.findById(id).exec());

async function resolveReport(id, { status, resolution }, actingUserId) {
  if (!['investigating', 'actioned', 'dismissed'].includes(status)) {
    throw new ValidationError('Invalid resolution status');
  }
  return runAsPlatform('resolve abuse report', async () => {
    const r = await AbuseReport.findById(id).exec();
    if (!r) throw new ValidationError('No such report');
    await AbuseReport.updateOne(
      { _id: r._id },
      { status, resolution, handledByUserId: currentUserId(), handledAt: new Date() }
    ).exec();
    await audit('abuse_report.' + status, 'AbuseReport', r._id, { category: r.category });
    return { ok: true };
  }, actingUserId);
}

/* ---- Break-glass ----------------------------------------------------------- */

/**
 * Open a time-boxed, notified grant to read a tenant's content. The ONLY path to
 * tenant content for platform staff. Writes the grant, the platform audit, and
 * notifies the institution's owner. Default window is 24 hours.
 */
async function openBreakglass({ tenantId, reportId, justification, hours = 24 }, actingUserId) {
  if (!justification || justification.trim().length < 10) {
    throw new ValidationError('A break-glass grant requires a written justification.');
  }
  return runAsPlatform('open break-glass', async () => {
    const tenant = await Tenant.findById(tenantId).exec();
    if (!tenant) throw new ValidationError('No such institution');

    const grant = await BreakglassGrant.create({
      tenantId,
      operatorUserId: actingUserId,
      reportId: reportId || undefined,
      justification: justification.trim(),
      expiresAt: new Date(Date.now() + hours * 3600 * 1000),
    });
    await audit('breakglass.opened', 'Tenant', tenant._id, { grantId: grant._id, hours, justification: grant.justification });

    // Notify the institution's owner — the bell that rings when the door is opened.
    const owner = await Membership.findOne({ tenantId, roles: 'owner', status: 'active' }).exec();
    if (owner) {
      await runWithTenant(tenantId, actingUserId, () =>
        notify({
          userId: owner.userId,
          template: 'breakglass_notice',
          channels: ['email'],
          data: { hours, justification: grant.justification, when: grant.grantedAt },
        })
      );
      await BreakglassGrant.updateOne({ _id: grant._id }, { ownerNotifiedAt: new Date() }).exec();
    }
    return { grant };
  }, actingUserId);
}

async function revokeBreakglass(grantId, actingUserId) {
  return runAsPlatform('revoke break-glass', async () => {
    const grant = await BreakglassGrant.findById(grantId).exec();
    if (!grant) throw new ValidationError('No such grant');
    await BreakglassGrant.updateOne({ _id: grant._id }, { revokedAt: new Date() }).exec();
    await audit('breakglass.revoked', 'Tenant', grant.tenantId, { grantId: grant._id });
    return { ok: true };
  }, actingUserId);
}

const listBreakglass = () =>
  runAsPlatform('list break-glass grants', () =>
    BreakglassGrant.find({}).sort({ grantedAt: -1 }).limit(100).populate('operatorUserId', 'email').exec()
  );

/**
 * Consume an active break-glass grant to READ a tenant's content. The grant must
 * exist, be unexpired and unrevoked, and belong to the operator asking. Every read
 * is written to the platform audit — the whole point of break-glass is that access
 * is visible. Eligibility gating is bypassed on purpose: this is an oversight read,
 * not a learner view.
 */
async function assertActiveGrant(grantId, actingUserId) {
  const grant = await runAsPlatform('load grant', () => BreakglassGrant.findById(grantId).exec());
  if (!grant) throw new ValidationError('No such grant');
  if (grant.revokedAt || grant.expiresAt <= new Date()) throw new ValidationError('This break-glass grant is no longer active.');
  if (String(grant.operatorUserId) !== String(actingUserId)) throw new ValidationError('This grant belongs to another operator.');
  return grant;
}

async function breakglassRead(grantId, actingUserId) {
  const grant = await assertActiveGrant(grantId, actingUserId);
  const tenant = await runAsPlatform('bg tenant', () => Tenant.findById(grant.tenantId).exec());
  const courses = await runWithTenant(grant.tenantId, actingUserId, async () => {
    const cs = await Course.find({}).sort({ code: 1 }).exec();
    const out = [];
    for (const c of cs) {
      const lessons = await Lesson.find({ courseId: c._id }).sort({ order: 1 }).exec();
      out.push({ course: c, lessons });
    }
    return out;
  });
  await runAsPlatform('breakglass view', () =>
    audit('breakglass.viewed', 'Tenant', grant.tenantId, { grantId: String(grant._id), scope: 'index' }),
  actingUserId);
  return { grant, tenant, courses };
}

async function breakglassLesson(grantId, lessonId, actingUserId) {
  const grant = await assertActiveGrant(grantId, actingUserId);
  const result = await runWithTenant(grant.tenantId, actingUserId, async () => {
    const lesson = await Lesson.findById(lessonId).exec();
    if (!lesson) throw new ValidationError('No such lesson');
    const blocks = await ContentBlock.find({ lessonId }).sort({ order: 1 }).exec();
    const rendered = [];
    for (const b of blocks) {
      if (b.assetId) {
        const asset = await Asset.findById(b.assetId).exec();
        const url = asset && asset.status === 'ready' ? await storage.signGet(asset.storageKey) : null;
        rendered.push({ type: b.type, url, filename: asset ? asset.filename : null, status: asset ? asset.status : 'missing' });
      } else {
        rendered.push({ type: b.type, body: b.body, embedUrl: b.embedUrl });
      }
    }
    return { lesson, blocks: rendered };
  });
  await runAsPlatform('breakglass view', () =>
    audit('breakglass.viewed', 'Lesson', lessonId, { grantId: String(grant._id), scope: 'lesson' }),
  actingUserId);
  return { grant, ...result };
}

/* ---- Platform audit -------------------------------------------------------- */

const recentAudit = (limit = 100) =>
  runAsPlatform('platform audit', () =>
    PlatformAuditLog.find({}).sort({ at: -1 }).limit(limit).populate('actorUserId', 'email name').exec()
  );

module.exports = {
  overview,
  listTenants, tenantDetail, suspendTenant, reactivateTenant, setPlan,
  editTenantMetadata, closeTenant, deleteTenant, restoreTenant,
  suspendUser, reactivateUser, forceLogout, sendPasswordReset,
  fileReport, listReports, reportDetail, resolveReport,
  openBreakglass, revokeBreakglass, listBreakglass, breakglassRead, breakglassLesson,
  listSuperadmins, grantSuperadmin, revokeSuperadmin,
  recentAudit,
};
