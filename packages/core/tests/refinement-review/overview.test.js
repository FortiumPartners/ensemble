/**
 * Tests for the customer-overview derivation used by the Overview tab when the
 * refinement command did not author a `document.customerSummary`.
 */
'use strict';

const { deriveCustomerOverview, normalizeHeading } = require('../../lib/refinement-review/overview');

describe('normalizeHeading', () => {
  test('strips hashes, ordinals, and decoration in either order', () => {
    expect(normalizeHeading('## Executive Summary')).toBe('executive summary');
    expect(normalizeHeading('### 2.1) Goals')).toBe('goals');
    expect(normalizeHeading('## 🎯 Objectives')).toBe('objectives');
    expect(normalizeHeading('## 🚀 2.1)   Background')).toBe('background');
    expect(normalizeHeading('#### Success Criteria')).toBe('success criteria');
  });

  test('lowercases and leaves plain words intact', () => {
    expect(normalizeHeading('## TARGET USERS')).toBe('target users');
    expect(normalizeHeading('### 3. What we are NOT building')).toBe('what we are not building');
  });
});

describe('deriveCustomerOverview', () => {
  const PRD = [
    '# Billing Refinement PRD',
    '',
    '## Executive Summary',
    '',
    'Customers subscribe monthly and receive an invoice automatically.',
    'The finance team stops reconciling payments by hand.',
    '',
    '### Background',
    '',
    'Manual invoicing currently costs about ten hours a week.',
    '',
    '## Goals',
    '',
    '- Ship automatic monthly billing',
    '- Remove manual reconciliation',
    '',
    '## Requirements',
    '',
    '| ID | Requirement |',
    '|---|---|',
    '| REQ-001 | The system must bill each subscriber monthly |',
    '',
    '### Acceptance Criteria',
    '',
    '**Given** a subscriber with a valid payment method',
    '**When** the billing cycle ends',
    '**Then** an invoice is issued and emailed',
    '',
    '```js',
    'const SECRET_TOKEN = "do-not-show-customers";',
    '```',
    '',
    '[NEEDS CLARIFICATION: pricing tier boundaries]',
    '',
    '[RISK: proration engine is a single point of failure]',
    '',
  ].join('\n');

  test('keeps customer sections and strips requirement detail', () => {
    const r = deriveCustomerOverview(PRD);
    expect(r.source).toBe('derived');
    expect(r.title).toBe('Billing Refinement PRD');
    expect(r.markdown).toContain('Customers subscribe monthly');
    expect(r.markdown).toContain('ten hours a week');
    expect(r.markdown).toContain('Ship automatic monthly billing');
    expect(r.markdown).not.toContain('REQ-001');
    expect(r.markdown).not.toContain('The system must bill');
    expect(r.markdown).not.toContain('Given');
    expect(r.markdown).not.toContain('When');
    expect(r.markdown).not.toContain('Then');
    expect(r.markdown).not.toContain('SECRET_TOKEN');
    expect(r.markdown).not.toContain('NEEDS CLARIFICATION');
    expect(r.markdown).not.toContain('RISK');
    expect(r.markdown).not.toContain('proration engine');
    expect(r.markdown).not.toMatch(/^\s*\|/m);
  });

  test('renders a title heading plus the customer pointer footer', () => {
    const r = deriveCustomerOverview(PRD);
    expect(r.markdown.startsWith('# Billing Refinement PRD\n\n')).toBe(true);
    expect(r.markdown).toContain('plain-language summary');
    expect(r.markdown).toContain('Refinement tab');
  });

  test('drops non-customer sections entirely', () => {
    const r = deriveCustomerOverview(PRD);
    // "Requirements" is not a customer heading: its own title must not appear.
    expect(r.markdown).not.toMatch(/^##+ Requirements/m);
    expect(r.markdown).not.toMatch(/^##+ Acceptance Criteria/m);
  });

  test('keeps headings nested inside a captured section', () => {
    const md = '# P\n\n## Goals\n\ntop prose\n\n### Success Metrics\n\nNinety percent fewer invoices.\n';
    const r = deriveCustomerOverview(md);
    expect(r.source).toBe('derived');
    expect(r.markdown).toContain('Success Metrics');
    expect(r.markdown).toContain('Ninety percent fewer invoices');
  });

  test('drops a nested heading that names a requirement, even with no other detail lines', () => {
    const md = '# P\n\n## Goals\n\ntop prose\n\n### REQ-001: Billing\n\n### Success Metrics\n\nNinety percent fewer invoices.\n';
    const r = deriveCustomerOverview(md);
    expect(r.source).toBe('derived');
    expect(r.markdown).not.toContain('REQ-001');
    expect(r.markdown).toContain('Success Metrics');
    expect(r.markdown).toContain('Ninety percent fewer invoices');
  });

  test('captures sections matched through decoration or ordinals', () => {
    const r = deriveCustomerOverview('# P\n\n## 🎯 Goals\n\nAutomate billing.\n');
    expect(r.source).toBe('derived');
    expect(r.markdown).toContain('Automate billing');
    const ord = deriveCustomerOverview('# P\n\n### 2.1. Background\n\nLegacy process.\n');
    expect(ord.source).toBe('derived');
    expect(ord.markdown).toContain('Legacy process');
  });

  test('a heading inside a captured section does not start a second section', () => {
    const r = deriveCustomerOverview('# P\n\n## Summary\n\nfirst\n\n## Overview\n\nsecond\n\n## Goals\n\nthird\n');
    expect(r.source).toBe('derived');
    // The whole span is customer-relevant, so all prose survives without the
    // interstitial heading being treated as a fresh section boundary.
    expect(r.markdown).toContain('first');
    expect(r.markdown).toContain('second');
    expect(r.markdown).toContain('third');
  });

  test('returns empty shape when no customer headings match', () => {
    const r = deriveCustomerOverview('# API TRD\n\n## Architecture\n\nUse Postgres.\n\n## Data Model\n\ntables\n');
    expect(r.source).toBe('empty');
    expect(r.markdown).toBe('');
    expect(r.title).toBe('API TRD');
  });

  test('a section with only stripped detail yields empty', () => {
    const r = deriveCustomerOverview('# P\n\n## Summary\n\n| ID | X |\n| REQ-001 | y |\n');
    expect(r.source).toBe('empty');
    expect(r.markdown).toBe('');
  });

  test('empty and non-string input return the empty shape without throwing', () => {
    expect(deriveCustomerOverview('')).toEqual({
      title: 'Product overview',
      markdown: '',
      source: 'empty',
    });
    expect(deriveCustomerOverview(undefined).source).toBe('empty');
    expect(deriveCustomerOverview(null).source).toBe('empty');
    expect(deriveCustomerOverview(42).source).toBe('empty');
    expect(deriveCustomerOverview('   \n\n  ').source).toBe('empty');
  });

  test('falls back to a generic title when there is no level-1 heading', () => {
    const r = deriveCustomerOverview('## Overview\n\nSome prose.\n');
    expect(r.title).toBe('Product overview');
    expect(r.source).toBe('derived');
  });

  test('collapses runs of blank lines to one blank line', () => {
    const r = deriveCustomerOverview('# P\n\n## Summary\n\na\n\n\n\n\n\nb\n');
    expect(r.markdown).toMatch(/a\n\nb/);
    expect(r.markdown).not.toMatch(/\n{3,}/);
  });

  test('caps output size so a huge document cannot flood the tab', () => {
    const body = Array.from({ length: 900 }, (_, i) => `line ${i}`).join('\n');
    const r = deriveCustomerOverview('# P\n\n## Summary\n\n' + body + '\n');
    expect(r.source).toBe('derived');
    expect(r.markdown).toContain('line 0');
    expect(r.markdown).toContain('line 399');
    expect(r.markdown).not.toContain('line 500');
  });

  test('ignores headings that only look like fences', () => {
    // A `#` inside a fenced block must not start or end a section.
    const md = '# P\n\n## Summary\n\nprose\n\n```\n## Requirements\n| REQ-001 | x |\n```\n';
    const r = deriveCustomerOverview(md);
    expect(r.source).toBe('derived');
    expect(r.markdown).toContain('prose');
    expect(r.markdown).not.toContain('REQ-001');
    expect(r.markdown).not.toMatch(/^##+ Requirements/m);
  });

  test('handles CRLF line endings', () => {
    const md = '# P\r\n\r\n## Summary\r\n\r\nWindows prose.\r\n';
    const r = deriveCustomerOverview(md);
    expect(r.source).toBe('derived');
    expect(r.markdown).toContain('Windows prose');
  });
});
