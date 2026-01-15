/**
 * schema.js - Eval Spec Schema Validator
 *
 * Validates YAML spec files against canonical schema.
 * Prevents schema drift through CI integration.
 */

const REQUIRED_FIELDS = ['name', 'version', 'fixture', 'variants', 'binary_checks', 'metrics', 'runs_per_variant', 'acceptance'];

/**
 * Validate that weights in an array sum to 1.0
 * @param {Array} items - Array of items with weight property
 * @param {string} itemType - Name of item type for error message
 * @returns {string|null} - Error message or null if valid
 */
function validateWeightSum(items, itemType) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const sum = items.reduce((acc, item) => acc + (item.weight || 0), 0);
  if (Math.abs(sum - 1.0) > 0.01) {
    return `${itemType} weights sum to ${sum.toFixed(2)}, expected 1.0`;
  }
  return null;
}

/**
 * Validate an eval spec against the canonical schema
 * @param {Object} spec - Parsed YAML spec
 * @returns {string[]} - Array of error messages (empty if valid)
 */
function validateSpec(spec) {
  const errors = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (spec[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check fixture.repo (not repository)
  if (spec.fixture) {
    if (spec.fixture.repository !== undefined) {
      errors.push('Use "repo" instead of "repository" in fixture');
    }
    if (!spec.fixture.repo && !spec.fixture.repository) {
      errors.push('Missing fixture.repo field');
    }
  }

  // Check variants is array (not map)
  if (spec.variants !== undefined) {
    if (!Array.isArray(spec.variants)) {
      errors.push('variants must be an array of objects, not a map');
    } else {
      // Check each variant has id
      spec.variants.forEach((variant, i) => {
        if (!variant.id && !variant.name) {
          errors.push(`Variant at index ${i} missing required field: id (or name)`);
        }
      });
    }
  }

  // Check for deprecated field names
  if (spec.binary_metrics !== undefined) {
    errors.push('Use "binary_checks" instead of "binary_metrics"');
  }
  if (spec.checks !== undefined && spec.binary_checks === undefined) {
    errors.push('Use "binary_checks" instead of "checks" for binary check definitions');
  }
  if (spec.judged_metrics !== undefined) {
    errors.push('Use "metrics" instead of "judged_metrics"');
  }

  // Check runs configuration
  if (spec.sessions_per_variant !== undefined) {
    errors.push('Use "runs_per_variant" instead of "sessions_per_variant"');
  }
  if (spec.execution && spec.execution.sessions_per_variant !== undefined) {
    errors.push('Use "runs_per_variant" instead of "execution.sessions_per_variant"');
  }

  // Validate binary_checks weight sum
  if (spec.binary_checks && Array.isArray(spec.binary_checks)) {
    const weightError = validateWeightSum(spec.binary_checks, 'binary_checks');
    if (weightError) errors.push(weightError);
  }

  // Validate metrics weight sum and rubric extensions
  if (spec.metrics && Array.isArray(spec.metrics)) {
    const weightError = validateWeightSum(spec.metrics, 'metrics');
    if (weightError) errors.push(weightError);

    // Check rubric extensions
    for (const metric of spec.metrics) {
      if (metric.rubric && !metric.rubric.endsWith('.md')) {
        errors.push(`Rubric "${metric.rubric}" should end with .md extension`);
      }
    }
  }

  // Check acceptance field names
  if (spec.acceptance) {
    if (spec.acceptance.minimum_binary_pass_rate !== undefined) {
      errors.push('Use "binary_pass_threshold" instead of "minimum_binary_pass_rate" in acceptance');
    }
  }

  return errors;
}

/**
 * Check if a spec is valid
 * @param {Object} spec - Parsed YAML spec
 * @returns {boolean} - True if valid
 */
function isValidSpec(spec) {
  return validateSpec(spec).length === 0;
}

module.exports = {
  validateSpec,
  validateWeightSum,
  isValidSpec,
  REQUIRED_FIELDS
};
