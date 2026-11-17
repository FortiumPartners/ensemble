'use strict';
const Database = require('better-sqlite3');

const db = new Database(process.env.DB_FILE || 'pawdesk.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS owners (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS patients (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, name TEXT NOT NULL, species TEXT NOT NULL, breed TEXT, birth_date TEXT);
  CREATE TABLE IF NOT EXISTS appointments (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, veterinarian TEXT NOT NULL, starts_at TEXT NOT NULL, reason TEXT);
  CREATE TABLE IF NOT EXISTS vaccinations (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, vaccine TEXT NOT NULL, given_on TEXT NOT NULL, due_on TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL, paid INTEGER DEFAULT 0);
`);

module.exports = db;
