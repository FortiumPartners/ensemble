const counts = new Map();

function add(name, by = 1) {
  counts.set(name, (counts.get(name) || 0) + by);
  return counts.get(name);
}

function get(name) {
  return counts.get(name) || 0;
}

function all() {
  return Object.fromEntries(counts);
}

module.exports = { add, get, all };
