'use strict';

const fs = require('fs');
const path = require('path');

describe('create-trd command document ids', () => {
  test('reuses source PRD micro UUID instead of allocating a new sequence', () => {
    const text = fs.readFileSync(path.join(__dirname, '../commands/create-trd.yaml'), 'utf8');
    expect(text).toContain('Derive the TRD document micro UUID from the source PRD');
    expect(text).toContain('PRD-YYYY-<micro_uuid>');
    expect(text).toContain('TRD_MICRO_UUID');
    expect(text).toContain('docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md');
    expect(text).toContain('Do NOT scan for highest TRD sequence number');
    expect(text).not.toContain('TRD-YYYY-NNN-<slug>.md');
  });
});
