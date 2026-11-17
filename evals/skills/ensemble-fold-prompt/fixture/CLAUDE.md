# Orders API

This project is the orders service for the storefront. It was started in 2023 by the
platform team, who moved to the payments group in 2024, and it has been maintained by
whoever had time since then. The team wiki has the full history of how we got here,
including the decision to use Express over Fastify, which was debated at length over
several weeks and eventually settled in favour of Express for familiarity.

## Getting started

To get going you install the dependencies with npm install and then you run the tests with
npm test to make sure that everything works on your machine. When you want to start the
server you run npm start, and when you want to check your style you run npm run lint,
which uses ESLint with the config in .eslintrc.json. Remember to run npm test before every
commit, and run npm test again after rebasing.

## Commands

- Install: `npm install`
- Test: `npm test`
- Lint: `npm run lint`
- Start: `npm start`
- Test (again, same thing): `npm test`

## Layout

Source lives in `src/`: routes in `src/routes/`, business logic in `src/services/`, errors
in `src/errors.js`. Tests are in `tests/`. The old parser in `src/legacy/old-parser.js` is
being phased out, see below.

## Conventions

Files are named in kebab-case, for example order-service.js and order-routes.js, and each
file starts with use strict. Services throw errors and routes catch them and pass them to
next so that the error middleware in app.js can answer. All errors extend AppError, never
Error directly, so that the status code travels with the error. Tests are named after the
file under test with a .test.js suffix and live in tests/.

## TODO

- TODO (2025-01-10): migrate the legacy parser and then migrate to Fastify.

## Express patterns (reference)

These are the patterns used across the routes. They are long and only matter when editing routes.

- Pattern 1: for the get handler of resource 1, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 2: for the create handler of resource 2, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 3: for the update handler of resource 3, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 4: for the cancel handler of resource 4, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 5: for the refund handler of resource 5, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 6: for the ship handler of resource 6, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 7: for the archive handler of resource 7, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 8: for the list handler of resource 8, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 9: for the get handler of resource 9, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 10: for the create handler of resource 10, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 11: for the update handler of resource 11, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 12: for the cancel handler of resource 12, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 13: for the refund handler of resource 13, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 14: for the ship handler of resource 14, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 15: for the archive handler of resource 15, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 16: for the list handler of resource 16, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 17: for the get handler of resource 17, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 18: for the create handler of resource 18, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 19: for the update handler of resource 19, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 20: for the cancel handler of resource 20, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 21: for the refund handler of resource 21, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 22: for the ship handler of resource 22, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 23: for the archive handler of resource 23, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 24: for the list handler of resource 24, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 25: for the get handler of resource 25, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 26: for the create handler of resource 26, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 27: for the update handler of resource 27, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 28: for the cancel handler of resource 28, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 29: for the refund handler of resource 29, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 30: for the ship handler of resource 30, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 31: for the archive handler of resource 31, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 32: for the list handler of resource 32, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 33: for the get handler of resource 33, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 34: for the create handler of resource 34, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 35: for the update handler of resource 35, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 36: for the cancel handler of resource 36, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 37: for the refund handler of resource 37, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 38: for the ship handler of resource 38, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 39: for the archive handler of resource 39, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.
- Pattern 40: for the list handler of resource 40, validate params first, call the service in a try block, send the result with res.json, and call next(e) in the catch block so the error middleware answers with the right status.

## Team

The team lunch is on Fridays. The product owner is on leave until further notice and the previous tech lead has left the company.
