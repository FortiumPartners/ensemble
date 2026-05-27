'use strict';

/**
 * Tests for ensemble-model-config-schema.json
 *
 * Ajv is not available in this package, so we implement manual validation
 * that mirrors the JSON Schema draft-07 constraints.
 */

const path = require('path');
const fs = require('fs');

const SCHEMA_PATH = path.resolve(__dirname, '../../../schemas/ensemble-model-config-schema.json');

/**
 * Minimal manual validator that checks the constraints defined in the schema.
 * Returns { valid: boolean, errors: string[] }.
 */
function validate(config) {
  const errors = [];

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    errors.push('root must be an object');
    return { valid: false, errors };
  }

  // required: version
  if (!Object.prototype.hasOwnProperty.call(config, 'version')) {
    errors.push("missing required property 'version'");
  } else if (typeof config.version !== 'number' || config.version !== 1) {
    errors.push(`version must be integer const 1, got ${JSON.stringify(config.version)}`);
  }

  // required: tiers
  if (!Object.prototype.hasOwnProperty.call(config, 'tiers')) {
    errors.push("missing required property 'tiers'");
  } else {
    const tiers = config.tiers;
    if (typeof tiers !== 'object' || tiers === null || Array.isArray(tiers)) {
      errors.push('tiers must be an object');
    } else {
      for (const key of ['high', 'medium', 'low']) {
        if (!Object.prototype.hasOwnProperty.call(tiers, key)) {
          errors.push(`tiers.${key} is required`);
        } else if (typeof tiers[key] !== 'string' || tiers[key].length < 1) {
          errors.push(`tiers.${key} must be a non-empty string`);
        }
      }
      // additionalProperties: false on tiers
      for (const key of Object.keys(tiers)) {
        if (!['high', 'medium', 'low'].includes(key)) {
          errors.push(`tiers has unknown additional property '${key}'`);
        }
      }
    }
  }

  // extraKnownModelIds: optional array of strings
  if (Object.prototype.hasOwnProperty.call(config, 'extraKnownModelIds')) {
    const extra = config.extraKnownModelIds;
    if (!Array.isArray(extra)) {
      errors.push('extraKnownModelIds must be an array');
    } else {
      extra.forEach((item, i) => {
        if (typeof item !== 'string') {
          errors.push(`extraKnownModelIds[${i}] must be a string`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

describe('ensemble-model-config-schema.json', () => {
  test('schema file exists and is valid JSON', () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
    const content = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test('schema has correct $schema and required fields', () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
    expect(schema['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.required).toEqual(expect.arrayContaining(['version', 'tiers']));
  });

  describe('validate()', () => {
    const validConfig = {
      version: 1,
      tiers: {
        high: 'claude-opus-4-7',
        medium: 'claude-sonnet-4-6',
        low: 'claude-haiku-4-5-20251001',
      },
    };

    test('valid config passes', () => {
      const { valid, errors } = validate(validConfig);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    test('config missing tiers.low fails with path tiers.low', () => {
      const cfg = {
        version: 1,
        tiers: {
          high: 'claude-opus-4-7',
          medium: 'claude-sonnet-4-6',
          // low is missing
        },
      };
      const { valid, errors } = validate(cfg);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes('tiers.low'))).toBe(true);
    });

    test('config with version 999 fails', () => {
      const cfg = { ...validConfig, version: 999 };
      const { valid, errors } = validate(cfg);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.toLowerCase().includes('version'))).toBe(true);
    });

    test('config with extra root key commandOverrides passes (additionalProperties: true)', () => {
      const cfg = {
        ...validConfig,
        commandOverrides: { 'ensemble:create-prd': 'high' },
      };
      const { valid, errors } = validate(cfg);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    test('config with extraKnownModelIds: ["claude-opus-5-preview"] passes', () => {
      const cfg = {
        ...validConfig,
        extraKnownModelIds: ['claude-opus-5-preview'],
      };
      const { valid, errors } = validate(cfg);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });
  });
});
