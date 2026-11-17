'use strict';

const express = require('express');
const { getOrder } = require('../services/order-service');

const router = express.Router();

router.get('/orders/:id', (req, res, next) => {
  try { res.json(getOrder(Number(req.params.id))); } catch (e) { next(e); }
});

module.exports = router;
