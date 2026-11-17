# Shop service

Pre-release checks for the shop service are described in `smoke-tests.json`.

Local helpers in `scripts/`:

- `db-ping.sh` connects to the database named by `DB_URL` (used by the database check).
- `journey-step.sh` places a test order (used by the checkout journey).
- `reset-db.sh` wipes the local development database. It is not part of any pre-release check.
