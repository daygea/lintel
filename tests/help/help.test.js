'use strict';

/**
 * The staff help page shows a topic when it targets everyone or one of the
 * member's roles — so an instructor sees course guidance but not owner-only
 * billing guidance.
 */

const controller = require('../../src/controllers/web/help.controller');

function topicsFor(roles) {
  let out;
  controller.show({ membership: { roles } }, { render: (view, data) => { out = { view, data }; } });
  return { view: out.view, ids: out.data.topics.map((t) => t.id) };
}

it('renders tenant/help with only role-relevant topics', () => {
  const instructor = topicsFor(['instructor']);
  expect(instructor.view).toBe('tenant/help');
  expect(instructor.ids).toContain('concept-standing'); // everyone
  expect(instructor.ids).toContain('courses');          // instructor
  expect(instructor.ids).not.toContain('billing');      // owner/admin only

  const owner = topicsFor(['owner']);
  expect(owner.ids).toContain('billing');
});
