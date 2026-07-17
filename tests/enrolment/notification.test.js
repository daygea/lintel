'use strict';

const { Tenant, User, Notification } = require('../../src/models');
const { runWithTenant } = require('../../src/lib/context');
const { notify, CHANNELS } = require('../../src/services/notification');

let tenant, user;
const as = (fn) => runWithTenant(tenant._id, null, fn);

beforeEach(async () => {
  tenant = await Tenant.create({ slug: 'inst', name: 'Institute', locales: ['en'] });
  user = await User.create({ email: 'a@x.com', name: 'A', phone: '+2348000000000', passwordHash: 'x', status: 'active' });
});

describe('notifications', () => {
  it('record one attempt per channel', async () => {
    await as(() =>
      notify({ userId: user._id, template: 'enrollment.activated', data: { cohortTitle: 'Diploma' }, channels: ['email', 'sms'] })
    );
    const notes = await as(() => Notification.find({ userId: user._id }).exec());
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.channel).sort()).toEqual(['email', 'sms']);
  });

  it('skip a channel with no address rather than failing', async () => {
    const noPhone = await User.create({ email: 'b@x.com', name: 'B', passwordHash: 'x', status: 'active' });
    const results = await as(() =>
      notify({ userId: noPhone._id, template: 'enrollment.activated', data: {}, channels: ['sms'] })
    );
    expect(results[0].status).toBe('skipped');
  });

  it('one channel failing does not stop another', async () => {
    // whatsapp throws by design; email should still send
    const results = await as(() =>
      notify({ userId: user._id, template: 'enrollment.activated', data: {}, channels: ['whatsapp', 'email'] })
    );
    const byChannel = Object.fromEntries(results.map((r) => [r.channel, r.status]));
    expect(byChannel.whatsapp).toBe('failed');
    expect(byChannel.email).toBe('sent');
  });
});

describe('the WhatsApp stub', () => {
  it('throws NotImplemented (ADR-013)', async () => {
    await expect(CHANNELS.whatsapp.send({ to: 'x', text: 'y' })).rejects.toThrow(/not implemented/i);
  });
});
