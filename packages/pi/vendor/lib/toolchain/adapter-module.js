'use strict';

/**
 * TRD-2026-6995dc96 TRD-016: confined in-process adapter module loading. Pure fs/path so the
 * require closure stays bundler-vendorable. The module path is validated BEFORE any require().
 */

const fs = require('fs');
const path = require('path');

function refused(message) {
  return { ok: false, error: { code: 'MODULE_PATH_REFUSED', message } };
}

/**
 * Resolve `modulePath` (relative to `adapterDir`) to a real file that lives inside the adapter's
 * own directory (symlinks followed).
 * @returns {{ok: true, file: string} | {ok: false, error: {code: string, message: string}}}
 */
function confineModulePath(adapterDir, modulePath) {
  if (typeof modulePath !== 'string' || modulePath.length === 0) {
    return refused('adapter module path must be a non-empty string');
  }
  if (typeof adapterDir !== 'string' || adapterDir.length === 0) {
    return refused('adapter directory is unknown; refusing to load module');
  }
  if (path.isAbsolute(modulePath) || path.win32.isAbsolute(modulePath)) {
    return refused(`adapter module path '${modulePath}' must be relative to the adapter directory`);
  }
  let root;
  let real;
  try {
    root = fs.realpathSync(adapterDir);
    real = fs.realpathSync(path.resolve(root, modulePath));
  } catch (error) {
    return refused(`adapter module '${modulePath}' cannot be resolved inside the adapter directory: ${error.code || error.message}`);
  }
  const rel = path.relative(root, real);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return refused(`adapter module '${modulePath}' resolves outside the adapter directory`);
  }
  let stat;
  try {
    stat = fs.statSync(real);
  } catch (error) {
    return refused(`adapter module '${modulePath}' is not readable: ${error.code || error.message}`);
  }
  if (!stat.isFile()) return refused(`adapter module '${modulePath}' is not a file`);
  return { ok: true, file: real };
}

module.exports = { confineModulePath };
