'use strict';

/**
 * The pagination helper (Oct-2026). Clamps junk ?page values and returns a bounded
 * page of rows plus the metadata a pager needs.
 */

const { paginate, pageOf } = require('../../src/lib/paginate');
const { User } = require('../../src/models');

describe('pageOf', () => {
  it('defaults junk and out-of-range values to a valid page', () => {
    expect(pageOf('abc', 5)).toBe(1);
    expect(pageOf('0', 5)).toBe(1);
    expect(pageOf('-3', 5)).toBe(1);
    expect(pageOf('999', 5)).toBe(5); // clamped to last page
    expect(pageOf('3', 5)).toBe(3);
    expect(pageOf(undefined, 5)).toBe(1);
  });
});

describe('paginate', () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i += 1) {
      await User.create({ email: `u${i}@x.io`, name: `User ${i}`, passwordHash: 'x', status: 'active' });
    }
  });

  it('returns a bounded page with correct metadata', async () => {
    const p1 = await paginate(User, {}, { page: 1, perPage: 2, sort: { email: 1 } });
    expect(p1.total).toBe(5);
    expect(p1.pages).toBe(3);
    expect(p1.rows).toHaveLength(2);
    expect(p1.hasPrev).toBe(false);
    expect(p1.hasNext).toBe(true);

    const p3 = await paginate(User, {}, { page: 3, perPage: 2, sort: { email: 1 } });
    expect(p3.rows).toHaveLength(1); // the remainder
    expect(p3.hasNext).toBe(false);
    expect(p3.hasPrev).toBe(true);
  });

  it('clamps an over-range page to the last page rather than returning empty', async () => {
    const p = await paginate(User, {}, { page: 99, perPage: 2, sort: { email: 1 } });
    expect(p.page).toBe(3);
    expect(p.rows).toHaveLength(1);
  });
});
