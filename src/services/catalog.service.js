'use strict';

/**
 * The learner catalogue — discovery for an institution's own offerings.
 *
 * Model note: this is NOT a cross-institution marketplace. It lists only the
 * courses an institution has marked `visibility: 'catalog'`, within the current
 * tenant, so a member can find what is on offer and apply. Standing still governs
 * what opens once enrolled; the catalogue governs only what is findable.
 */

const { Course, Cohort, Application, Enrollment, Asset } = require('../models');
const storage = require('../lib/storage');
const commerce = require('./commerce');
const { pick } = require('../plugins/locale-map');

async function catalogue({ userId, locale = 'en' } = {}) {
  const courses = await Course.find({ visibility: 'catalog' })
    .sort({ order: 1, code: 1 })
    .populate('programId')
    .exec();
  if (!courses.length) return { courses: [], programmes: [] };

  const courseIds = courses.map((c) => c._id);
  const openCohorts = await Cohort.find({ status: 'open', courseId: { $in: courseIds } })
    .sort({ startsAt: 1 })
    .exec();
  const apps = userId ? await Application.find({ userId }).exec() : [];
  const enrolls = userId ? await Enrollment.find({ userId }).exec() : [];

  const appliedCohorts = new Set(apps.map((a) => String(a.cohortId)));
  const enrolledCourses = new Set(enrolls.map((e) => String(e.courseId)));
  const cohortsByCourse = new Map();
  for (const ch of openCohorts) {
    const k = String(ch.courseId);
    if (!cohortsByCourse.has(k)) cohortsByCourse.set(k, []);
    cohortsByCourse.get(k).push(ch);
  }

  const programmes = new Set();
  const out = [];
  for (const c of courses) {
    let coverUrl = null;
    if (c.coverAssetId) {
      const cover = await Asset.findById(c.coverAssetId).exec();
      if (cover && cover.storageKey) {
        try { coverUrl = await storage.signGet(cover.storageKey); } catch (_) { /* storage optional */ }
      }
    }

    const cohorts = [];
    for (const ch of cohortsByCourse.get(String(c._id)) || []) {
      let fee = null;
      try { fee = await commerce.cohortFee(ch._id); } catch (_) { fee = null; }
      cohorts.push({
        id: ch._id,
        title: pick(ch.title, locale),
        session: ch.session,
        startsAt: ch.startsAt,
        fee,
        applied: appliedCohorts.has(String(ch._id)),
      });
    }

    const programme = c.programId ? pick(c.programId.title, locale) : null;
    if (programme) programmes.add(programme);

    const title = pick(c.title, locale);
    const summary = c.summary ? pick(c.summary, locale) : '';
    const hasOpen = cohorts.length > 0;
    const free = hasOpen ? cohorts.every((x) => !x.fee) : null;

    out.push({
      id: c._id,
      code: c.code,
      title,
      summary,
      programme,
      session: c.session,
      coverUrl,
      enrolled: enrolledCourses.has(String(c._id)),
      openCohorts: cohorts,
      hasOpen,
      free,
      // Precomputed so the view never calls a string method on a maybe-undefined
      // field (keeps the client-side filter simple and the view fragility-safe).
      search: `${title} ${summary} ${programme || ''} ${c.code || ''}`.toLowerCase(),
    });
  }

  return { courses: out, programmes: [...programmes].sort() };
}

module.exports = { catalogue };
