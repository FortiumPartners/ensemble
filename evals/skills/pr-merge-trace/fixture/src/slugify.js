'use strict';

function slugify(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

module.exports = { slugify };
