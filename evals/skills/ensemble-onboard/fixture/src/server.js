'use strict';
const express = require('express');
const invoices = require('./routes/invoices');

const app = express();
app.use(express.json());
app.use('/invoices', invoices);
app.get('/healthz', (req, res) => res.send('ok'));

app.listen(process.env.PORT || 8080);
