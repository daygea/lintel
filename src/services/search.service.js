'use strict';

const { Course, Lesson, Program } = require('../models');
const { fold } = require('../plugins/locale-map');

/**
 * Search is diacritic-INSENSITIVE; display is diacritic-CORRECT.
 *
 * Searching "oriki" must find a lesson titled "Oríkì". A learner on a phone
 * keyboard cannot type tone marks, and refusing to find their own coursework
 * because of that would be its own small insult.
 *
 * The locale-map plugin maintains a folded shadow field per locale-mapped path;
 * we query the shadow and return the original.
 */
async function search(term, { limit = 20 } = {}) {
  const needle = fold(term || '');
  if (needle.length < 2) return { courses: [], lessons: [], programs: [] };

  const rx = new RegExp(escape(needle), 'i');

  const [courses, lessons, programs] = await Promise.all([
    Course.find({ $or: [{ title__search: rx }, { summary__search: rx }] })
      .limit(limit)
      .exec(),
    Lesson.find({ title__search: rx }).limit(limit).exec(),
    Program.find({ $or: [{ title__search: rx }, { description__search: rx }] })
      .limit(limit)
      .exec(),
  ]);

  return { courses, lessons, programs };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { search };
