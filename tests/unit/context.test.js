'use strict';

const { runWithTenant, runAsPlatform, currentTenantId, isPlatform } = require('../../src/lib/context');
const { NoTenantContextError } = require('../../src/lib/errors');

describe('tenant context', () => {
  it('throws outside any context', () => {
    expect(() => currentTenantId()).toThrow(NoTenantContextError);
  });

  it('carries the tenant through async boundaries', async () => {
    await runWithTenant('tenant-a', 'user-1', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(currentTenantId()).toBe('tenant-a');
    });
  });

  it('does not leak between concurrent contexts', async () => {
    const seen = [];
    await Promise.all([
      runWithTenant('a', 'u', async () => {
        await new Promise((r) => setTimeout(r, 10));
        seen.push(currentTenantId());
      }),
      runWithTenant('b', 'u', async () => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push(currentTenantId());
      }),
    ]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('platform context refuses to pretend it has a tenant', () => {
    runAsPlatform('unit test', () => {
      expect(isPlatform()).toBe(true);
      expect(() => currentTenantId()).toThrow(NoTenantContextError);
    });
  });

  it('runAsPlatform demands a reason', () => {
    expect(() => runAsPlatform(null, () => {})).toThrow(/reason/);
  });
});
