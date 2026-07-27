'use strict';

const directory = require('../../services/directory.service');
const { listCourses } = require('../../services/curriculum.service');
const { pick } = require('../../plugins/locale-map');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

/** The institution's own view of its public listing — edit, publish, unpublish. */
exports.show = h(async (req, res) => {
  const listing = await directory.getOwnListing();
  const courses = await listCourses().catch(() => []);
  res.render('directory/manage', {
    listing, courses, pick,
    locale: req.tenant.defaultLocale,
    rootDomain: process.env.ROOT_DOMAIN || 'localhost',
    error: null,
  });
});

exports.save = h(async (req, res) => {
  try {
    const featured = []
      .concat(req.body.featuredCourseIds || [])
      .filter(Boolean);
    await directory.upsertListing({
      handle: req.body.handle,
      displayName: req.body.displayName,
      tagline: localeFrom(req.body, 'tagline', req.tenant),
      about: localeFrom(req.body, 'about', req.tenant),
      contact: {
        email: req.body.contact_email,
        website: req.body.contact_website,
        city: req.body.contact_city,
        country: req.body.contact_country,
      },
      featuredCourseIds: featured,
    });
    res.redirect('/directory-listing');
  } catch (err) {
    const listing = await directory.getOwnListing();
    const courses = await listCourses().catch(() => []);
    res.status(400).render('directory/manage', {
      listing, courses, pick, locale: req.tenant.defaultLocale,
      rootDomain: process.env.ROOT_DOMAIN || 'localhost', error: err.message,
    });
  }
});

exports.publish = h(async (req, res) => {
  await directory.publish();
  res.redirect('/directory-listing');
});

exports.unpublish = h(async (req, res) => {
  await directory.unpublish();
  res.redirect('/directory-listing');
});

/** Build a locale map from title_en / title_yo style fields. */
function localeFrom(body, base, tenant) {
  const map = {};
  for (const loc of tenant.locales) {
    const v = body[`${base}_${loc}`];
    if (v) map[loc] = v;
  }
  return map;
}
