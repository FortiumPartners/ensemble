'use strict';

const items = [];

function push(item) {
  items.push(item);
  return items.length;
}

function shift() {
  return items.shift();
}

module.exports = { push, shift };
