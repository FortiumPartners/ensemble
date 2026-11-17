'use strict';
const router = require('express').Router();
const db = require('../db');

// Front desk registers a new animal together with its owner.
router.post('/', (req, res) => {
  const { ownerName, phone, name, species, breed } = req.body;
  const owner = db.prepare('INSERT INTO owners (name, phone) VALUES (?, ?)').run(ownerName, phone);
  const patient = db.prepare('INSERT INTO patients (owner_id, name, species, breed) VALUES (?, ?, ?, ?)').run(owner.lastInsertRowid, name, species, breed);
  res.status(201).json({ id: patient.lastInsertRowid });
});

router.get('/:id/vaccinations', (req, res) => {
  res.json(db.prepare('SELECT vaccine, given_on, due_on FROM vaccinations WHERE patient_id = ? ORDER BY due_on').all(req.params.id));
});

router.post('/:id/vaccinations', (req, res) => {
  const { vaccine, givenOn, dueOn } = req.body;
  db.prepare('INSERT INTO vaccinations (patient_id, vaccine, given_on, due_on) VALUES (?, ?, ?, ?)').run(req.params.id, vaccine, givenOn, dueOn);
  res.status(201).end();
});

module.exports = router;
