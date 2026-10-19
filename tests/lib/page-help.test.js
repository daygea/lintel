'use strict';

// describe/it/expect are globals (vitest config: globals: true) — do not import them.
const pageHelp = require('../../src/lib/page-help');

// The canonical nav keys each layout sets, minus 'help' (the help pages
// themselves carry no per-page help button). Kept here as the contract: if a
// page is added with a new nav key, this list and the registry both update,
// and a mismatch fails the suite rather than silently shipping a page with no
// help panel.
const TENANT_NAV = [
  'members', 'register', 'courses', 'media', 'cohorts',
  'policies', 'accesslog', 'assessments', 'gradebook',
  'fees', 'credentials', 'directory',
];
const CONSOLE_NAV = [
  'overview', 'institutions', 'applications', 'operators',
  'reports', 'breakglass', 'audit',
];

function assertEntry(entry, key) {
  expect(entry, `missing help entry for "${key}"`).toBeTruthy();
  expect(typeof entry.title, `${key}.title`).toBe('string');
  expect(entry.title.length, `${key}.title non-empty`).toBeGreaterThan(0);
  expect(typeof entry.what, `${key}.what`).toBe('string');
  expect(entry.what.length, `${key}.what non-empty`).toBeGreaterThan(0);
  expect(Array.isArray(entry.actions), `${key}.actions is array`).toBe(true);
  expect(entry.actions.length, `${key}.actions non-empty`).toBeGreaterThan(0);
  entry.actions.forEach((a, i) => {
    expect(typeof a, `${key}.actions[${i}]`).toBe('string');
    expect(a.trim().length, `${key}.actions[${i}] non-empty`).toBeGreaterThan(0);
  });
  if ('tip' in entry) {
    expect(typeof entry.tip, `${key}.tip`).toBe('string');
    expect(entry.tip.trim().length, `${key}.tip non-empty`).toBeGreaterThan(0);
  }
}

describe('page-help registry', () => {
  it('exposes tenant and console namespaces', () => {
    expect(pageHelp.tenant).toBeTypeOf('object');
    expect(pageHelp.console).toBeTypeOf('object');
  });

  it('has a well-formed entry for every tenant nav key', () => {
    TENANT_NAV.forEach((key) => assertEntry(pageHelp.tenant[key], `tenant.${key}`));
  });

  it('has a well-formed entry for every console nav key', () => {
    CONSOLE_NAV.forEach((key) => assertEntry(pageHelp.console[key], `console.${key}`));
  });

  it('does not define help for the help pages themselves', () => {
    expect(pageHelp.tenant.help).toBeUndefined();
    expect(pageHelp.console.help).toBeUndefined();
  });

  it('defines no keys beyond the known nav set (catches drift/typos)', () => {
    expect(Object.keys(pageHelp.tenant).sort()).toEqual([...TENANT_NAV].sort());
    expect(Object.keys(pageHelp.console).sort()).toEqual([...CONSOLE_NAV].sort());
  });
});
