'use strict';

/**
 * locale-map
 *
 * Every learner-visible content field is a map of locale -> string, never a bare
 * string. Retrofitting i18n is a rewrite; paying for it now is a field type.
 *
 * Each LocaleMap field gets a shadow field `<path>__search` holding the
 * diacritic-folded text of every locale, so search is diacritic-INsensitive
 * while display stays diacritic-CORRECT. Searching "oriki" finds "Oríkì".
 *
 * Used from Sprint 1 onward. Defined in Sprint 0 so check-locale-fields has
 * something to enforce against.
 */

const { Schema } = require('mongoose');

const LocaleMapType = { type: Map, of: String, default: undefined };

function fold(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function localeMap(schema, options = {}) {
  const paths = options.paths || [];

  for (const path of paths) {
    schema.add({ [`${path}__search`]: { type: String, index: true, select: false } });
  }

  schema.pre('validate', function buildSearchShadow() {
    for (const path of paths) {
      const value = this.get(path);
      if (!value) continue;
      const values = value instanceof Map ? [...value.values()] : Object.values(value);
      this.set(`${path}__search`, values.map(fold).join(' '));
    }
  });

  schema.statics.localePaths = paths;
}

function pick(map, locale, fallback = 'en') {
  if (!map) return '';
  const get = (k) => (map instanceof Map ? map.get(k) : map[k]);
  return get(locale) || get(fallback) || '';
}

module.exports = { localeMap, LocaleMapType, fold, pick, Schema };
