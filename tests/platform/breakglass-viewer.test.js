'use strict';

/**
 * Break-glass content viewer. An active grant, held by the operator asking, reads
 * the tenant's content and writes a platform-audit entry. An expired or revoked
 * grant, or one belonging to someone else, is refused.
 */

const {
  Tenant, User, Course, Module, Lesson, ContentBlock, BreakglassGrant, PlatformAuditLog,
} = require('../../src/models');
const { runAsPlatform, runWithTenant } = require('../../src/lib/context');
const platform = require('../../src/services/platform.service');

let tenant, operator, other, lessonId;

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'test-bg', name: 'Alpha', locales: ['en'], status: 'active' });
  operator = await User.create({ email: 'op@x.io', name: 'Op', passwordHash: await User.hashPassword('x'.repeat(12)), platformRole: 'superadmin' });
  other = await User.create({ email: 'other@x.io', name: 'Other', passwordHash: await User.hashPassword('x'.repeat(12)), platformRole: 'superadmin' });
  await runWithTenant(tenant._id, operator._id, async () => {
    const course = await Course.create({ code: 'C1', title: { en: 'Foundations' }, status: 'active' });
    const mod = await Module.create({ courseId: course._id, title: { en: 'M' }, order: 0 });
    const lesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, title: { en: 'Week 1' }, order: 0 });
    lessonId = lesson._id;
    await ContentBlock.create({ lessonId: lesson._id, type: 'rich_text', body: { en: '<p>secret</p>' }, order: 0 });
  });
});

const makeGrant = (opts = {}) =>
  runAsPlatform('seed grant', () => BreakglassGrant.create({
    tenantId: tenant._id,
    operatorUserId: opts.operator || operator._id,
    justification: 'Investigating a report',
    expiresAt: opts.expiresAt || new Date(Date.now() + 3600 * 1000),
    revokedAt: opts.revokedAt || undefined,
  }));

it('reads content under an active grant and writes an audit entry', async () => {
  const grant = await makeGrant();
  const view = await platform.breakglassRead(grant._id, operator._id);
  expect(view.tenant.name).toBe('Alpha');
  expect(view.courses).toHaveLength(1);
  expect(view.courses[0].lessons).toHaveLength(1);

  const logged = await runAsPlatform('check', () =>
    PlatformAuditLog.findOne({ action: 'breakglass.viewed', subjectId: tenant._id }).exec());
  expect(logged).toBeTruthy();
});

it('reads a lesson\'s blocks under an active grant', async () => {
  const grant = await makeGrant();
  const view = await platform.breakglassLesson(grant._id, lessonId, operator._id);
  expect(view.blocks).toHaveLength(1);
  expect(view.blocks[0].type).toBe('rich_text');
});

it('refuses an expired grant', async () => {
  const grant = await makeGrant({ expiresAt: new Date(Date.now() - 1000) });
  await expect(platform.breakglassRead(grant._id, operator._id)).rejects.toThrow(/no longer active/i);
});

it('refuses a revoked grant', async () => {
  const grant = await makeGrant({ revokedAt: new Date() });
  await expect(platform.breakglassRead(grant._id, operator._id)).rejects.toThrow(/no longer active/i);
});

it('refuses a grant that belongs to another operator', async () => {
  const grant = await makeGrant({ operator: other._id });
  await expect(platform.breakglassRead(grant._id, operator._id)).rejects.toThrow(/another operator/i);
});
