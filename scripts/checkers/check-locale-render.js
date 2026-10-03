'use strict';
const { walk, read, rel } = require('./lib');

/**
 * Locale maps are read with pick(), never bracket-indexed.
 *
 * A locale field (title, tagline, about, …) is a Mongoose Map. In a view,
 * `doc.title[locale]` uses JS object indexing, which on a Map returns UNDEFINED —
 * so the field renders blank even though the data is there. The symptom is
 * invisible on create (the value is in the payload) and only shows on EDIT/reload:
 * the form comes back empty, and it looks like the save was lost. That exact bug
 * shipped in the directory admin form. Use pick(field, locale).
 *
 * Only flags property access followed by a locale-looking index — e.g.
 * `listing.tagline[loc]` — not form-field name building like `body['tagline_'+loc]`.
 */
const LOCALE_FIELDS = [
  'title', 'tagline', 'about', 'summary', 'label', 'description',
  'denialMessage', 'body', 'instructions', 'feedback', 'transcript',
];

module.exports = function checkLocaleRender() {
  const problems = [];
  const re = new RegExp(`\\.(${LOCALE_FIELDS.join('|')})\\s*\\[\\s*(loc|locale|lang|l)\\s*\\]`, 'g');
  for (const file of walk('src/views')) {
    if (!file.endsWith('.ejs')) continue;
    const src = read(file);
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) {
        problems.push(
          `${rel(file)}:${i + 1}: reads a locale-map field with bracket access (…[${RegExp.$2 || 'locale'}]) — a Map returns undefined, so it renders blank on edit. Use pick(field, locale).`
        );
      }
      re.lastIndex = 0;
    });
  }
  return problems;
};
