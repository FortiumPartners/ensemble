'use strict';

const express = require('express');
const orderRoutes = require('./routes/order-routes');

const app = express();
app.use(orderRoutes);
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = app;
