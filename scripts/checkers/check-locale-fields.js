'use strict';
const { walk, read, rel } = require('./lib');

/** Learner-visible content is a locale map, never a bare string. */
const CONTENT_FIELDS = ['title', 'summary', 'description', 'instructions', 'denialMessage', 'body', 'label'];

module.exports = function checkLocaleFields() {
  const problems = [];
  for (const file of walk('src/models')) {
    const src = read(file);
    for (const field of CONTENT_FIELDS) {
      const re = new RegExp(`\\b${field}\\s*:\\s*\\{\\s*type\\s*:\\s*String`);
      if (re.test(src)) {
        problems.push(
          `${rel(file)}: content field "${field}" is typed String. Use LocaleMapType from plugins/locale-map.js — i18n cannot be retrofitted.`
        );
      }
    }
  }
  return problems;
};
