'use strict';

const { TenantApplication, Tenant, User, Membership } = require('../models');
const { provision } = require('./tenant.service');
const { sendAccountDetails } = require('./onboarding.service');
const { notify, sendDirectEmail } = require('./notification');
const { runAsPlatform, runWithTenant, currentUserId } = require('../lib/context');
const { ValidationError } = require('../lib/errors');
const env = require('../config/env');
const crypto = require('node:crypto');

// Subdomains an institution may not claim — product/system routes and rude words
// would be a support nightmare. Extend as needed.
const RESERVED = new Set([
  'www','app','api','admin','mail','smtp','ftp','ns','dns','static','assets','cdn',
  'help','support','docs','status','blog','directory','verify','onboard','login',
  'signup','register','dashboard','lintel','test','staging','dev','root','system',
]);

const SLUG_RE = /^[a-z][a-z0-9-]{2,38}[a-z0-9]$/;

function validateSlug(slug) {
  const s = String(slug || '').toLowerCase().trim();
  if (!SLUG_RE.test(s)) {
    throw new ValidationError('Choose an address of 4–40 letters, numbers or hyphens, starting with a letter.');
  }
  if (RESERVED.has(s)) throw new ValidationError('That address is reserved. Please choose another.');
  return s;
}

/** Is a slug free across BOTH live tenants and pending applications? */
async function slugAvailable(slug) {
  const s = validateSlug(slug);
  return runAsPlatform('signup slug availability', async () => {
    const t = await Tenant.findOne({ slug: s }).exec();
    if (t) return false;
    const a = await TenantApplication.findOne({ requestedSlug: s, status: { $in: ['pending', 'approved'] } }).exec();
    return !a;
  });
}

/**
 * An institution applies from the home page. If auto-provision is on, this both
 * creates the application AND approves it immediately, returning a live tenant.
 * Otherwise it queues the application and notifies the platform for review.
 */
async function apply({ institutionName, requestedSlug, contactName, contactEmail, country, about, plan = 'trial' }) {
  if (!institutionName || !contactEmail || !contactName) {
    throw new ValidationError('We need the institution name, your name, and a contact email.');
  }
  const slug = validateSlug(requestedSlug);
  if (!(await slugAvailable(slug))) throw new ValidationError('That address is already taken.');

  const application = await runAsPlatform('tenant application', () =>
    TenantApplication.create({
      institutionName, requestedSlug: slug, contactName,
      contactEmail: String(contactEmail).toLowerCase(), country, about, plan,
    })
  );

  // Console tier: tell the platform a request came in (both paths). Best-effort.
  await notifySuperadminsOfApplication(application);

  if (env.autoProvisionTenants) {
    const result = await approve({ applicationId: application._id, systemApproved: true });
    return { application, ...result, instant: true };
  }

  // Institution tier: acknowledge the applicant so they're not left in silence —
  // on the review path there's no other email until a decision is made.
  await sendDirectEmail({
    to: application.contactEmail,
    subject: `We've received your Lintel request for ${application.institutionName}`,
    text:
      `Hi ${application.contactName},\n\n` +
      `Thanks for requesting access to Lintel for ${application.institutionName} ` +
      `(${application.requestedSlug}.${env.rootDomain}). Our team will review your request ` +
      `and reply to this address.\n\n— Lintel`,
  });

  return { application, instant: false };
}

/** Email every superadmin (or the bootstrap address) that a new institution applied. */
async function notifySuperadminsOfApplication(application) {
  try {
    const admins = await runAsPlatform('superadmin recipients', () =>
      User.find({ platformRole: 'superadmin' }).select('email').exec()
    );
    let recipients = admins.map((a) => a.email).filter(Boolean);
    if (!recipients.length && process.env.SUPERADMIN_EMAIL) recipients = [process.env.SUPERADMIN_EMAIL];

    const link = `https://${env.rootDomain}/console/applications`;
    const subject = `New institution request: ${application.institutionName}`;
    const text = [
      `A new institution has requested access to Lintel${env.autoProvisionTenants ? ' (auto-provisioned)' : ' (pending review)'}.`,
      '',
      `Institution: ${application.institutionName}`,
      `Address:     ${application.requestedSlug}.${env.rootDomain}`,
      `Contact:     ${application.contactName} <${application.contactEmail}>`,
      application.country ? `Country:     ${application.country}` : null,
      application.about ? `About:       ${application.about}` : null,
      '',
      `Review: ${link}`,
    ].filter((l) => l !== null).join('\n');

    for (const to of recipients) {
      await sendDirectEmail({ to, subject, text });
    }
  } catch (err) {
    // best-effort — a mail failure must never block the application itself
  }
}

/**
 * Approve an application: provision the tenant, create the owner account, and
 * email the owner their account details (set-password link + optional temp
 * password). Idempotent-ish: a second approve is refused.
 */
async function approve({ applicationId, systemApproved = false }) {
  return runAsPlatform('tenant application approval', async () => {
    const app = await TenantApplication.findById(applicationId).exec();
    if (!app) throw new ValidationError('No such application');
    if (app.status === 'approved') throw new ValidationError('Already approved');

    // Owner user: reuse if the email already exists, else create pending.
    let owner = await User.findOne({ email: app.contactEmail }).exec();
    if (!owner) {
      owner = await User.create({
        email: app.contactEmail,
        name: app.contactName,
        passwordHash: await User.hashPassword(crypto.randomBytes(24).toString('hex')),
        status: 'pending',
      });
    }

    const tenant = await provision({
      slug: app.requestedSlug,
      name: app.institutionName,
      ownerUserId: owner._id,
      plan: app.plan || 'trial',
    });

    await TenantApplication.updateOne(
      { _id: app._id },
      {
        status: 'approved',
        reviewedByUserId: systemApproved ? null : currentUserId(),
        reviewedAt: new Date(),
        tenantId: tenant._id,
        ownerUserId: owner._id,
      }
    ).exec();

    // The account-details email: set-password link + temp password fallback.
    // Sent INSIDE the tenant's context — notify() writes a tenant-scoped
    // Notification, which must be stamped with this institution's id (we are
    // otherwise in platform context here, where the guard refuses to infer it).
    await runWithTenant(tenant._id, owner._id, () =>
      sendAccountDetails({
        userId: owner._id,
        tenantId: tenant._id,
        institutionName: tenant.name,
        roleLabel: 'owner',
        withTempPassword: true,
      })
    );

    return { tenant, owner };
  });
}

async function decline({ applicationId, reason }) {
  return runAsPlatform('tenant application decline', async () => {
    const app = await TenantApplication.findById(applicationId).exec();
    if (!app) throw new ValidationError('No such application');
    await TenantApplication.updateOne(
      { _id: app._id },
      { status: 'declined', declineReason: reason, reviewedByUserId: currentUserId(), reviewedAt: new Date() }
    ).exec();
    return { declined: true };
  });
}

const listApplications = (status = 'pending') =>
  runAsPlatform('list tenant applications', () =>
    TenantApplication.find(status ? { status } : {}).sort({ createdAt: -1 }).exec()
  );

module.exports = { apply, approve, decline, slugAvailable, validateSlug, listApplications };
