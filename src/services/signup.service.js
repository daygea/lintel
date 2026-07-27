'use strict';

const { TenantApplication, Tenant, User, Membership } = require('../models');
const { provision } = require('./tenant.service');
const { sendAccountDetails } = require('./onboarding.service');
const { notify } = require('./notification');
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

  if (env.autoProvisionTenants) {
    const result = await approve({ applicationId: application._id, systemApproved: true });
    return { application, ...result, instant: true };
  }

  // Review path: acknowledge to the applicant, flag for the platform.
  await runAsPlatform('signup ack', async () => {
    // A lightweight applicant-facing user may not exist yet; acknowledge by email
    // directly through the channel is out of scope here — the ack email is sent
    // on approval. We simply record the pending application.
  });

  return { application, instant: false };
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
