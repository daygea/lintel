'use strict';

/**
 * A new institution request tells the console (superadmins) and acknowledges the
 * applicant — the two ends of the institution→console handoff. The acknowledgement
 * is the review-path behaviour (auto-provision off), so we pin that here.
 */

const { User } = require('../../src/models');
const { CHANNELS } = require('../../src/services/notification');
const signup = require('../../src/services/signup.service');

it('emails superadmins and acknowledges the applicant on a new request', async () => {
  const prev = process.env.AUTO_PROVISION_TENANTS;
  process.env.AUTO_PROVISION_TENANTS = 'false'; // review path: applicant ack + superadmin notice
  const spy = vi.spyOn(CHANNELS.email, 'send').mockResolvedValue({ providerRef: 'x' });
  try {
    await User.create({
      email: 'admin@lintel.africa', name: 'Admin', platformRole: 'superadmin',
      passwordHash: await User.hashPassword('x'.repeat(12)),
    });

    await signup.apply({
      institutionName: 'Oyo Tech', requestedSlug: 'oyotech',
      contactName: 'Ada', contactEmail: 'ada@oyo.edu', country: 'NG', about: 'A test school',
    });

    const to = spy.mock.calls.map((c) => c[0].to);
    const subjects = spy.mock.calls.map((c) => c[0].subject);
    expect(to).toContain('ada@oyo.edu');           // applicant acknowledgement
    expect(to).toContain('admin@lintel.africa');   // superadmin notice
    expect(subjects.some((s) => /received/i.test(s))).toBe(true);
    expect(subjects.some((s) => /new institution request/i.test(s))).toBe(true);
  } finally {
    spy.mockRestore();
    if (prev === undefined) delete process.env.AUTO_PROVISION_TENANTS;
    else process.env.AUTO_PROVISION_TENANTS = prev;
  }
});
