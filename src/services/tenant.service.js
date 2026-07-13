'use strict';

const { Tenant, Membership, AuditLog, User } = require('../models');
const { PLANS } = require('../config/plans');
const { ValidationError } = require('../lib/errors');
const { ROLES } = require('../lib/roles');
const { runWithTenant, runAsPlatform } = require('../lib/context');

/**
 * Tenant creation is a PLATFORM operation — there is no tenant context yet.
 * runAsPlatform() is greppable on purpose: every use must be justifiable.
 */
async function provision({ slug, name, ownerUserId, plan = 'trial', baseCurrency = 'NGN', locales = ['en'] }) {
  if (!PLANS[plan]) throw new ValidationError(`Unknown plan: ${plan}`);

  const owner = await User.findById(ownerUserId);
  if (!owner) throw new ValidationError('Owner user does not exist');

  const clash = await Tenant.findOne({ slug: String(slug).toLowerCase() });
  if (clash) throw new ValidationError('That address is already taken');

  const tenant = await Tenant.create({
    slug: String(slug).toLowerCase(),
    name,
    plan,
    features: PLANS[plan].features,
    baseCurrency,
    locales,
    defaultLocale: locales[0],
    status: 'trial',
  });

  await runWithTenant(tenant._id, ownerUserId, async () => {
    await Membership.create({
      userId: ownerUserId,
      roles: [ROLES.OWNER, ROLES.ADMIN],
      status: 'active',
      joinedAt: new Date(),
    });
    await AuditLog.create({
      actorUserId: ownerUserId,
      action: 'tenant.provisioned',
      subjectType: 'Tenant',
      subjectId: tenant._id,
      meta: { slug: tenant.slug, plan },
    });
  });

  return tenant;
}

async function setPlan(tenantId, plan) {
  if (!PLANS[plan]) throw new ValidationError(`Unknown plan: ${plan}`);
  return runAsPlatform('changing a tenant subscription plan', () =>
    Tenant.findByIdAndUpdate(tenantId, { plan, features: PLANS[plan].features }, { new: true })
  );
}

async function updateBranding({ name, branding, locales }) {
  const tenantId = require('../lib/context').currentTenantId();
  return runAsPlatform('tenant admin updating own branding', () =>
    Tenant.findByIdAndUpdate(tenantId, { name, branding, locales }, { new: true })
  );
}

module.exports = { provision, setPlan, updateBranding };
