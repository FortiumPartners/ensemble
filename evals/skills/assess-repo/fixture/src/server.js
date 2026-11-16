const express = require('express');
const { reserve } = require('./lockers');
const { apiKey } = require('./config');

const app = express();
app.use(express.json());

app.post('/reserve', (req, res) => {
  if (req.get('x-api-key') !== apiKey) return res.status(401).end();
  const slot = reserve(req.body.building, req.body.resident);
  res.json({ slot });
});

app.listen(3000);
