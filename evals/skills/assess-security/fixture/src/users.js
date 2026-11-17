'use strict';
const db = require('./db');

function validateEmail(email) {
  return typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email);
}

async function createUser(input) {
  if (!validateEmail(input.email)) throw new Error('invalid email');
  const record = { name: input.name, email: input.email, ssn: input.ssn, dob: input.dob };
  await db.query('INSERT INTO users (name, email, ssn, dob) VALUES ($1, $2, $3, $4)', [record.name, record.email, record.ssn, record.dob]);
  return record;
}

async function getUser(id) {
  return db.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
}

module.exports = { createUser, getUser, validateEmail };
