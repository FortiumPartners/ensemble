'use strict';
const Redis = require('ioredis');
const config = require('../../configs/app.json');

const redis = new Redis(config.cache.url);

async function get(key) {
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function set(key, value) {
  await redis.set(key, JSON.stringify(value), 'EX', config.cache.ttlSeconds);
}

module.exports = { get, set };
