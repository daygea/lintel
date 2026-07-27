'use strict';
const { walk, read, rel } = require('./lib');

/** Learner-visible content is a locale map, never a bare string. */
const CONTENT_FIELDS = ['title', 'summary', 'description', 'instructions', 'denialMessage', 'body', 'label'];

/**
 * A field carrying an admin-only, never-learner-facing string (a config name, an
 * internal identifier) may opt out with a trailing `// @admin-string` on the same
 * line. The exemption is deliberately explicit and greppable — you must SAY that
 * a field is admin-only, so the default stays "everything learner-facing is a
 * locale map" and the exceptions are visible in review.
 */
module.exports = function checkLocaleFields() {
  const problems = [];
  for (const file of walk('src/models')) {
    const src = read(file);
    for (const field of CONTENT_FIELDS) {
      const re = new RegExp(`\\b${field}\\s*:\\s*\\{\\s*type\\s*:\\s*String[^\\n]*`);
      const m = src.match(re);
      if (m && !m[0].includes('@admin-string')) {
        problems.push(
          `${rel(file)}: content field "${field}" is typed String. Use LocaleMapType from plugins/locale-map.js — i18n cannot be retrofitted. (If this is an admin-only config string, mark it // @admin-string.)`
        );
      }
    }
  }
  return problems;
};
