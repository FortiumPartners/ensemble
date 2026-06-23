'use strict';

const fs = require('fs');
const path = require('path');

describe('create-prd command document ids', () => {
  test('uses micro UUID artifact IDs instead of sequence numbers', () => {
    const text = fs.readFileSync(path.join(__dirname, '../commands/create-prd.yaml'), 'utf8');
    expect(text).toContain('PRD-{current_year}-{micro_uuid}');
    expect(text).toContain('8 lowercase hex');
    expect(text).toContain('Do NOT scan for highest sequence numbers');
    expect(text).toContain('docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md');
    expect(text).not.toContain('find highest PRD-YYYY-NNN and increment');
  });
});
