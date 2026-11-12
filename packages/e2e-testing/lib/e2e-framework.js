'use strict';

/**
 * Which C# test framework does the consuming E2E test project use? spec-writer.js emits NUnit or xUnit
 * accordingly. Read from the project's own PackageReference names; a project that references both (or
 * neither) is not guessed at: the caller gets null and falls back to NUnit, the shape this command has always emitted.
 */

const fs = require('fs');
const path = require('path');

const PACKAGE_RE = /<PackageReference\b[^>]*?\bInclude\s*=\s*"([^"]+)"/gi;
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git']);

/**
 * Drop every complete `<!-- ... -->` comment. A scan rather than a regex replace: a replace can splice the
 * pieces on either side of a removed comment into a new `<!--` (CodeQL js/incomplete-multi-character-sanitization),
 * and this single left-to-right pass never rescans what it kept. An opener with no closer is left as written.
 */
function stripXmlComments(text) {
  let out = '';
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    const close = open < 0 ? -1 : text.indexOf('-->', open + 4);
    if (close < 0) return out + text.slice(from);
    out += text.slice(from, open);
    from = close + 3;
  }
}

/** @param {string|string[]} csprojTexts - one or more .csproj files' text */
function detectE2eFramework(csprojTexts) {
  const texts = Array.isArray(csprojTexts) ? csprojTexts : [csprojTexts];
  let nunit = false;
  let xunit = false;
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    for (const match of stripXmlComments(text).matchAll(PACKAGE_RE)) {
      const name = match[1].toLowerCase();
      if (name.startsWith('nunit') || name === 'microsoft.playwright.nunit') nunit = true;
      if (name.startsWith('xunit') || name === 'microsoft.playwright.xunit') xunit = true;
    }
  }
  if (nunit === xunit) return null; // neither, or both: ambiguous
  return nunit ? 'nunit' : 'xunit';
}

/** Detect from every .csproj under `dir` (skipping bin, obj, node_modules, .git). */
function detectE2eFrameworkInDir(dir, opts = {}) {
  const readdirSync = opts.readdirSync || ((p) => fs.readdirSync(p, { withFileTypes: true }));
  const readFileSync = opts.readFileSync || ((p) => fs.readFileSync(p, 'utf8'));
  const texts = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(current, entry.name));
      } else if (entry.name.toLowerCase().endsWith('.csproj')) {
        texts.push(readFileSync(path.join(current, entry.name)));
      }
    }
  };
  walk(dir);
  return detectE2eFramework(texts);
}

module.exports = { detectE2eFramework, detectE2eFrameworkInDir };
