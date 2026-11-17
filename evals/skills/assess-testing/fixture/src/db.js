'use strict';

const tables = new Map();

function save(table, row) {
  if (!tables.has(table)) tables.set(table, []);
  const rows = tables.get(table);
  rows.push({ id: rows.length + 1, ...row });
  return rows.length;
}

function find(table, id) {
  return (tables.get(table) || []).find((r) => r.id === id);
}

function update(table, id, patch) {
  Object.assign(find(table, id), patch);
}

module.exports = { save, find, update };
