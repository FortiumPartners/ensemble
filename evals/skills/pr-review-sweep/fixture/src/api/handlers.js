'use strict';

const { Lru } = require('../cache/lru');

const pages = new Lru(100);

function getPage(slug, render) {
  const hit = pages.get(slug);
  if (hit !== undefined) return hit;
  const html = render(slug);
  pages.set(slug, html);
  return html;
}

module.exports = { getPage };
