'use strict';

const fs = require('fs');
const path = require('path');

describe('create-trd command document ids', () => {
  test('uses micro UUID artifact IDs instead of sequence numbers', () => {
    const text = fs.readFileSync(path.join(__dirname, '../commands/create-trd.yaml'), 'utf8');
    expect(text).toContain('TRD-YYYY-<micro_uuid>');
    expect(text).toContain('8 lowercase hex');
    expect(text).toContain('Do NOT scan for highest TRD sequence number');
    expect(text).toContain('docs/TRD/TRD-YYYY-<micro_uuid>-<slug>.md');
    expect(text).not.toContain('TRD-YYYY-NNN-<slug>.md');
  });
});
