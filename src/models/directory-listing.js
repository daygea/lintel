'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantGuard = require('../plugins/tenant-guard');
const { localeMap, LocaleMapType } = require('../plugins/locale-map');

/**
 * An institution's public directory presence. Publication is an ACT (ADR-011):
 * a DirectoryListing exists only because a named human at the institution chose
 * to create it, and it is visible only while publishedAt is set. There is no
 * "public: true" flag on Tenant that a bug could flip — presence in the directory
 * is a separate, deliberate object.
 *
 * What it may carry: the institution's name, a description, contact, and a
 * curated set of course TITLES it chooses to advertise. What it must NEVER carry:
 * course content, learners, standings, prices, or anything the eligibility engine
 * guards. The public projection (directory.service) enforces that; this model is
 * the editable draft behind it.
 */
const DirectoryListingSchema = new Schema(
  {
    // The public handle, globally unique — this is how a stranger reaches the page.
    handle: { type: String, required: true, trim: true, lowercase: true },

    displayName: { type: String, required: true }, // @admin-string — the institution's chosen public name
    tagline: LocaleMapType,
    about: LocaleMapType,

    contact: {
      email: String,
      website: String,
      city: String,      // @admin-string — a city, not a street address
      country: String,   // @admin-string
    },

    /** Course ids the institution has chosen to advertise. Titles only are shown. */
    featuredCourseIds: [{ type: Schema.Types.ObjectId, ref: 'Course' }],

    /** Publication is an act: null = not published, a date = published then. */
    publishedAt: Date,
    publishedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

DirectoryListingSchema.plugin(tenantGuard);
DirectoryListingSchema.plugin(localeMap, { paths: ['tagline', 'about'] });

// The tenantId index comes from the tenant-guard plugin. "One listing per tenant"
// is enforced by the service (upsertListing does findOne-then-update within the
// tenant scope), not a second unique index that would collide with the plugin's.
// The handle is a deliberate GLOBAL namespace — the one index not led by tenantId.
DirectoryListingSchema.index({ handle: 1 }, { unique: true }); // @global-unique — the directory handle is a deliberate cross-tenant public namespace

module.exports = mongoose.model('DirectoryListing', DirectoryListingSchema);
