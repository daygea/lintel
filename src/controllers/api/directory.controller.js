'use strict';

const dir = require('../../services/directory.service');

const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

// Tenant-side (authed, staff).
exports.get = h(async (req, res) => res.json({ listing: await dir.getOwnListing() }));
exports.upsert = h(async (req, res) => res.status(201).json({ listing: await dir.upsertListing(req.body) }));
exports.publish = h(async (req, res) => res.json({ listing: await dir.publish() }));
exports.unpublish = h(async (req, res) => res.json({ listing: await dir.unpublish() }));
