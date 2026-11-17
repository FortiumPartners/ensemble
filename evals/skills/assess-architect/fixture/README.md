# orderdesk

A small order-management HTTP service: controllers take requests, services hold the rules, repositories talk to Postgres,
Redis caches reads and a BullMQ worker sends confirmation e-mails.
