'use strict';

/** Lowercase the text and join runs of letters and digits with a single dash. */
function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
