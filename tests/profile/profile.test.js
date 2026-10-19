'use strict';

/**
 * Self-service profile editing (Oct-2026). Every user can update their own name and
 * phone and change their password; email (the login identity) is not editable here.
 */

const { User } = require('../../src/models');
const auth = require('../../src/services/auth.service');

let user;
beforeEach(async () => {
  user = await User.create({
    email: 'me@x.io', name: 'Old Name', phone: '',
    passwordHash: await User.hashPassword('old-password-123'), status: 'active',
  });
});

describe('updateProfile', () => {
  it('updates name and phone', async () => {
    await auth.updateProfile({ userId: user._id, name: '  New Name  ', phone: ' 0803 000 0000 ' });
    const fresh = await User.findById(user._id).exec();
    expect(fresh.name).toBe('New Name');     // trimmed
    expect(fresh.phone).toBe('0803 000 0000');
  });

  it('rejects an empty name', async () => {
    await expect(auth.updateProfile({ userId: user._id, name: '   ' })).rejects.toThrow();
    const fresh = await User.findById(user._id).exec();
    expect(fresh.name).toBe('Old Name'); // unchanged
  });

  it('does not change the email', async () => {
    await auth.updateProfile({ userId: user._id, name: 'New Name' });
    const fresh = await User.findById(user._id).exec();
    expect(fresh.email).toBe('me@x.io');
  });
});

describe('changePassword', () => {
  it('changes the password when the current one is correct', async () => {
    const out = await auth.changePassword({ userId: user._id, currentPassword: 'old-password-123', newPassword: 'brand-new-456' });
    expect(out.ok).toBe(true);
    const fresh = await User.findById(user._id).select('+passwordHash').exec();
    expect(await fresh.verifyPassword('brand-new-456')).toBe(true);
    expect(await fresh.verifyPassword('old-password-123')).toBe(false);
  });

  it('rejects a wrong current password', async () => {
    await expect(auth.changePassword({ userId: user._id, currentPassword: 'wrong', newPassword: 'brand-new-456' })).rejects.toThrow();
  });

  it('rejects a too-short new password', async () => {
    await expect(auth.changePassword({ userId: user._id, currentPassword: 'old-password-123', newPassword: 'short' })).rejects.toThrow();
  });
});
