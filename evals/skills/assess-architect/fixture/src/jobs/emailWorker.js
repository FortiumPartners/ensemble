'use strict';
const { Queue, Worker } = require('bullmq');
const config = require('../../configs/app.json');

const queue = new Queue(config.queue.name, { connection: { url: config.cache.url } });

async function enqueueConfirmation(order) {
  await queue.add('confirmation', { orderId: order.id });
}

function startWorker() {
  return new Worker(config.queue.name, async (job) => {
    console.log('sending confirmation for', job.data.orderId);
  }, { concurrency: config.queue.concurrency, connection: { url: config.cache.url } });
}

module.exports = { enqueueConfirmation, startWorker };
