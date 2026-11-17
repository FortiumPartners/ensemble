# Architecture

Each folder under `services/` is a small module exporting plain functions. `lib/util.js` holds shared helpers. There are no network
calls in this repository; the shop front end lives elsewhere.
