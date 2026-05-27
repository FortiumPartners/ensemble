'use strict';

/**
 * Canonical list of fully-pinned Claude model IDs.
 *
 * This is the single source of truth used by config-loader, model-resolver,
 * map-model-wizard, and lint-script. All IDs must be fully-pinned (no "-latest").
 */
const KNOWN_MODEL_IDS = Object.freeze([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]);

module.exports = { KNOWN_MODEL_IDS };
