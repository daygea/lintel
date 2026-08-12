'use strict';

const { DirectoryListing, Course, Tenant } = require('../models');
const { ValidationError } = require('../lib/errors');
const { currentUserId, runAsPlatform } = require('../lib/context');
const { pick } = require('../plugins/locale-map');

// Institutions in these states must never appear in the public directory, even
// with a published listing: suspended = locked out, closed/deleted = gone.
const DIRECTORY_HIDDEN_STATUSES = ['suspended', 'closed', 'deleted'];

/* --------------------------------------------------------- tenant-side edit */

const getOwnListing = () => DirectoryListing.findOne({}).exec();

async function upsertListing(data) {
  if (!data.handle || !data.displayName) {
    throw new ValidationError('A listing needs a handle and a display name');
  }
  const existing = await DirectoryListing.findOne({}).exec();
  if (existing) {
    // Assign + save (not updateOne): tagline/about are Mongoose Map fields, and a
    // raw updateOne doesn't cast a plain object into a Map or run the localeMap
    // validate hook — so the update path silently dropped them.
    Object.assign(existing, data);
    await existing.save();
    return existing;
  }
  return DirectoryListing.create(data);
}

/**
 * Publish is an ACT. It stamps who and when; nothing is public until this runs,
 * and unpublish clears the stamp. There is no boolean anywhere else that grants
 * visibility — this object's publishedAt is the single source of truth.
 */
async function publish() {
  const listing = await DirectoryListing.findOne({}).exec();
  if (!listing) throw new ValidationError('No listing to publish');
  await DirectoryListing.updateOne(
    { _id: listing._id },
    { publishedAt: new Date(), publishedByUserId: currentUserId() }
  ).exec();
  return DirectoryListing.findById(listing._id).exec();
}

async function unpublish() {
  const listing = await DirectoryListing.findOne({}).exec();
  if (!listing) throw new ValidationError('No listing');
  await DirectoryListing.updateOne({ _id: listing._id }, { $unset: { publishedAt: 1 } }).exec();
  return DirectoryListing.findById(listing._id).exec();
}

/* ------------------------------------------------------------ public read */

/**
 * THE public projection. Called with no session, across tenants, by a stranger.
 * Runs as platform (the handle is globally unique). Returns ONLY the fields an
 * institution chose to advertise — and course TITLES, never content.
 *
 * This function is the entire public surface of the directory. If a field is not
 * built into the object below, it cannot leak. An unpublished listing returns
 * null, indistinguishable from one that never existed — fail closed.
 */
async function publicView(handle) {
  return runAsPlatform('public directory view (no session)', async () => {
    const listing = await DirectoryListing.findOne({ handle }).exec();
    if (!listing || !listing.publishedAt) return null; // not published = not found

    const tenant = await Tenant.findById(listing.tenantId).exec();
    // An institution that is suspended, closed, or deleted is not operational —
    // don't surface it publicly even though its listing is still marked published.
    if (!tenant || DIRECTORY_HIDDEN_STATUSES.includes(tenant.status)) return null;

    // Course TITLES only, and only the ones featured AND marked directory-visible.
    // A course the institution didn't feature, or didn't set to directory
    // visibility, is absent — two independent gates.
    const courses = await Course.find({
      _id: { $in: listing.featuredCourseIds || [] },
      visibility: { $in: ['directory', 'catalog'] },
    }).exec();

    return {
      handle: listing.handle,
      slug: tenant?.slug, // the sign-in subdomain (public — it's where people log in)
      displayName: listing.displayName,
      tagline: listing.tagline,
      about: listing.about,
      contact: {
        email: listing.contact?.email,
        website: listing.contact?.website,
        city: listing.contact?.city,
        country: listing.contact?.country,
      },
      institution: tenant?.name,
      // TITLES ONLY. No modules, no lessons, no content, no counts of learners.
      courses: courses.map((c) => ({ title: c.title, code: c.code })),
    };
  });
}

/**
 * The directory index — published listings only, for a search/browse page. Runs
 * as platform. Returns the same minimal shape, never content.
 */
async function browse({ q, limit = 50 } = {}) {
  return runAsPlatform('public directory browse (no session)', async () => {
    // Exclude institutions that aren't operational (suspended/closed/deleted),
    // even if their listing is still marked published, so the limit applies to
    // visible ones only. The hidden set is small (non-live tenants).
    const hidden = await Tenant.find({ status: { $in: DIRECTORY_HIDDEN_STATUSES } }).select('_id').exec();
    const filter = { publishedAt: { $exists: true }, tenantId: { $nin: hidden.map((t) => t._id) } };
    const listings = await DirectoryListing.find(filter).sort({ publishedAt: -1 }).limit(limit).exec();
    const rows = listings.map((l) => ({
      handle: l.handle,
      displayName: l.displayName,
      tagline: l.tagline,
      city: l.contact?.city,
      country: l.contact?.country,
    }));
    if (!q) return rows;
    const needle = String(q).toLowerCase();
    return rows.filter((r) => r.displayName.toLowerCase().includes(needle));
  });
}

module.exports = { getOwnListing, upsertListing, publish, unpublish, publicView, browse };
