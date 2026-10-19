'use strict';

const DEFAULT_PER_PAGE = 25;

/**
 * Clamp a raw ?page value (a string off the query, or a number) to a valid page in
 * [1, pages]. Junk ("abc", 0, -3, 999) collapses to the nearest valid page.
 */
function pageOf(raw, pages) {
  let p = parseInt(raw, 10);
  if (!Number.isFinite(p) || p < 1) p = 1;
  if (pages && p > pages) p = pages;
  return p;
}

/**
 * Paginate a Mongoose model query. Returns the requested page of rows plus the
 * metadata a pager needs — so a list can grow without end and the UI stays bounded,
 * instead of fetching everything (or silently capping at .limit(200) and hiding the
 * rest). `sort`, `populate` and `select` mirror the usual query builders.
 */
async function paginate(model, filter = {}, { page = 1, perPage = DEFAULT_PER_PAGE, sort, populate, select } = {}) {
  const total = await model.countDocuments(filter).exec();
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = pageOf(page, pages);
  let q = model.find(filter);
  if (sort) q = q.sort(sort);
  if (populate) q = q.populate(populate);
  if (select) q = q.select(select);
  const rows = await q.skip((current - 1) * perPage).limit(perPage).exec();
  return { rows, total, page: current, pages, perPage, hasPrev: current > 1, hasNext: current < pages };
}

module.exports = { paginate, pageOf, DEFAULT_PER_PAGE };
