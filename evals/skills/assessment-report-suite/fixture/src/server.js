const express = require('express');
const tallies = require('./tallies');
const { apiKey, port } = require('./config');

const app = express();
app.use(express.json());

app.post('/tallies/:name', (req, res) => {
  if (req.get('x-api-key') !== apiKey) return res.status(401).end();
  res.json({ name: req.params.name, count: tallies.add(req.params.name, req.body.by) });
});

app.get('/tallies', (req, res) => res.json(tallies.all()));

app.listen(port);
