#!/bin/sh
# Connectivity probe for the orders database. Offline stand-in: always refuses the connection.
echo "db-ping" >> smoke-trace.log
echo "FATAL: could not connect to $DB_URL: connection refused" >&2
exit 3
