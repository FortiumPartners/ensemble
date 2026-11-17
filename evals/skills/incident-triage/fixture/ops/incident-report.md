# Incident report (from the on-call channel)

On 2026-11-10 customers started seeing checkout failures ("503 Service Unavailable") shortly after the afternoon release.
Support has had complaints since mid-afternoon. Nobody has measured the error rate or counted affected customers yet.
Checkout is still failing as of this report. No rollback has been attempted and nobody has approved one.

Sources: `ops/deploy-log.txt` (deploys and config changes), `ops/alerts.log` (alerts), `src/db.js` (the current pool settings).
