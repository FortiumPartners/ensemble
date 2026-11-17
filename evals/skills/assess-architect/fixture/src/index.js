'use strict';
const express = require('express');
const config = require('../configs/app.json');
const orders = require('./controllers/orderController');
const { startWorker } = require('./jobs/emailWorker');

const app = express();
app.use(express.json());
app.get('/orders/:id', orders.getOrder);
app.post('/orders', orders.createOrder);

startWorker();
app.listen(config.port);
