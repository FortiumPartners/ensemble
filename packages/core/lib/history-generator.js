'use strict';

/**
 * History Generator Module
 * Generates ENSEMBLE-HISTORY.md from PRD and TRD documents.
 *
 * @module history-generator
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const { HistoryError, scanAndParseDocuments } = require('./document-parser');

/**
 * @typedef {import('./document-parser').ParsedDocument} ParsedDocument
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {string} date - Entry date (YYYY-MM-DD)
 * @property {string} title - Feature title
 * @property {ParsedDocument|null} prd - Linked PRD
 * @property {ParsedDocument|null} trd - Linked TRD
 * @property {string|null} status - Combined status
 * @property {string|null} problem - Problem summary
 * @property {string|null} solution - Solution summary
 * @property {string[]} decisions - Combined key decisions
 */

/**
 * @typedef {Object} GenerationStats
 * @property {number} prdCount - Number of PRDs processed
 * @property {number} trdCount - Number of TRDs processed
 * @property {number} entryCount - Number of entries generated
 * @property {number} matchedPairs - Number of matched PRD/TRD pairs
 * @property {number} prdOnly - Number of PRDs without TRDs
 * @property {number} trdOnly - Number of TRDs without PRDs
 */

/**
 * @typedef {Object} GenerationResult
 * @property {boolean} success - Whether generation succeeded
 * @property {string} outputPath - Path to generated file
 * @property {GenerationStats} stats - Generation statistics
 * @property {Array<{code: string, file: string, message: string}>} warnings - Warnings encountered
 * @property {string|null} gitCommit - Git commit hash if committed
 * @property {number} duration - Duration in milliseconds
 * @property {string|null} error - Error message if failed
 */

/**
 * Convert filename to human-readable title
 * @param {string} filename - e.g., "yaml-to-markdown-generator"
 * @returns {string} - e.g., "YAML to Markdown Generator"
 */
function formatTitle(filename) {
  return filename
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Yaml/g, 'YAML')
    .replace(/Trd/g, 'TRD')
    .replace(/Prd/g, 'PRD')
    .replace(/Api/g, 'API')
    .replace(/Cli/g, 'CLI')
    .replace(/Ui/g, 'UI')
    .replace(/Md/g, 'MD');
}

/**
 * Match PRDs with TRDs by base filename
 * @param {ParsedDocument[]} prds - Parsed PRD documents
 * @param {ParsedDocument[]} trds - Parsed TRD documents
 * @returns {HistoryEntry[]} Matched and sorted history entries
 */
function matchDocuments(prds, trds) {
  const entries = new Map(); // filename -> HistoryEntry

  // Track filenames for duplicate detection
  const prdFilenames = new Set();
  const trdFilenames = new Set();

  // Process PRDs first
  for (const prd of prds) {
    if (prdFilenames.has(prd.filename)) {
      console.warn(`[HIST-E004] Duplicate filename detected: ${prd.filename} (PRD)`);
      continue;
    }
    prdFilenames.add(prd.filename);

    entries.set(prd.filename, {
      date: prd.date,
      title: prd.title || formatTitle(prd.filename),
      prd: prd,
      trd: null,
      status: prd.status,
      problem: prd.problem,
      solution: prd.solution,
      decisions: [...prd.decisions]
    });
  }

  // Match TRDs
  for (const trd of trds) {
    if (trdFilenames.has(trd.filename)) {
      console.warn(`[HIST-E004] Duplicate filename detected: ${trd.filename} (TRD)`);
      continue;
    }
    trdFilenames.add(trd.filename);

    if (entries.has(trd.filename)) {
      // Merge with existing PRD entry
      const entry = entries.get(trd.filename);
      entry.trd = trd;
      // Prefer TRD date if PRD date missing
      entry.date = entry.date || trd.date;
      // Use TRD status if PRD status missing
      entry.status = entry.status || trd.status;
      // Merge problem/solution if missing
      entry.problem = entry.problem || trd.problem;
      entry.solution = entry.solution || trd.solution;
      // Merge decisions (deduplicate, limit to 5)
      const mergedDecisions = [...new Set([...entry.decisions, ...trd.decisions])];
      entry.decisions = mergedDecisions.slice(0, 5);
    } else {
      // TRD without PRD
      entries.set(trd.filename, {
        date: trd.date,
        title: trd.title || formatTitle(trd.filename),
        prd: null,
        trd: trd,
        status: trd.status,
        problem: trd.problem,
        solution: trd.solution,
        decisions: [...trd.decisions]
      });
    }
  }

  // Sort by date (newest first)
  return Array.from(entries.values())
    .sort((a, b) => (b.date || '0000-00-00').localeCompare(a.date || '0000-00-00'));
}

/**
 * Generate markdown content for ENSEMBLE-HISTORY.md
 * @param {HistoryEntry[]} entries - Sorted history entries
 * @param {GenerationStats} stats - Generation statistics
 * @returns {string} Markdown content
 */
function generateMarkdown(entries, stats) {
  const lines = [
    '# Ensemble Project History',
    '',
    '> Chronological record of architectural decisions and feature implementations',
    '> Auto-generated from PRDs and TRDs - Do not edit manually',
    '',
    `**Last Updated**: ${new Date().toISOString().split('T')[0]}`,
    `**PRDs Processed**: ${stats.prdCount}`,
    `**TRDs Processed**: ${stats.trdCount}`,
    '',
    '---',
    ''
  ];

  for (const entry of entries) {
    // Entry header
    lines.push(`## ${entry.date || 'Unknown Date'} - ${entry.title}`);
    lines.push('');

    // Document links (relative to .claude/ directory)
    if (entry.prd) {
      const prdLabel = entry.prd.id || entry.prd.filename;
      lines.push(`**PRD**: [${prdLabel}](../docs/PRD/${entry.prd.filename}.md)`);
    }
    if (entry.trd) {
      const trdLabel = entry.trd.id || entry.trd.filename;
      lines.push(`**TRD**: [${trdLabel}](../docs/TRD/${entry.trd.filename}.md)`);
    }

    // Status indicators
    if (!entry.prd && entry.trd) {
      lines.push('*TRD only - no linked PRD*');
    }
    if (entry.prd && !entry.trd) {
      lines.push('*PRD only - TRD pending*');
    }

    // Status
    if (entry.status) {
      lines.push(`**Status**: ${entry.status}`);
    }
    lines.push('');

    // Problem
    if (entry.problem) {
      lines.push('### Problem');
      lines.push(entry.problem);
      lines.push('');
    }

    // Solution
    if (entry.solution) {
      lines.push('### Solution');
      lines.push(entry.solution);
      lines.push('');
    }

    // Key Decisions
    if (entry.decisions.length > 0) {
      lines.push('### Key Decisions');
      for (const decision of entry.decisions) {
        lines.push(`- ${decision}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check if we're in a git repository
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
function isGitRepository(cwd) {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if file has changes (staged or unstaged)
 * @param {string} filepath - Path to file
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
function hasChanges(filepath, cwd) {
  try {
    // Check if file exists in git
    try {
      execSync(`git ls-files --error-unmatch "${filepath}"`, { cwd, stdio: 'ignore' });
    } catch (error) {
      // File is new/untracked
      return true;
    }

    // Check for changes
    execSync(`git diff --quiet "${filepath}"`, { cwd, stdio: 'ignore' });
    execSync(`git diff --cached --quiet "${filepath}"`, { cwd, stdio: 'ignore' });
    return false;
  } catch (error) {
    // File has changes
    return true;
  }
}

/**
 * Commit ENSEMBLE-HISTORY.md with conventional commit message
 * @param {string} filepath - Path to history file
 * @param {GenerationStats} stats - Generation statistics
 * @param {string} cwd - Working directory
 * @returns {string|null} Commit hash or null if not committed
 */
function commitHistoryFile(filepath, stats, cwd) {
  // Check if in git repo
  if (!isGitRepository(cwd)) {
    console.warn('[HIST-W005] Skipped git commit: not in git repository');
    return null;
  }

  // Check if file has changes
  if (!hasChanges(filepath, cwd)) {
    console.log('[HIST-E007] Nothing to commit - history unchanged');
    return null;
  }

  try {
    // Stage file
    execSync(`git add "${filepath}"`, { cwd, stdio: 'ignore' });

    // Create commit message
    const date = new Date().toISOString().split('T')[0];
    const message = `docs(history): update ENSEMBLE-HISTORY.md with latest PRD/TRD changes

- Generated from ${stats.prdCount} PRDs and ${stats.trdCount} TRDs
- Last updated: ${date}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>`;

    // Commit
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd,
      stdio: 'pipe'
    });

    // Get commit hash
    const hash = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim();
    return hash;
  } catch (error) {
    console.error(`[HIST-E006] Git command failed: ${error.message}`);
    return null;
  }
}

/**
 * Generate ENSEMBLE-HISTORY.md from PRDs and TRDs
 * @param {Object} options
 * @param {string} options.docsDir - Path to docs directory
 * @param {string} [options.outputPath] - Output file path (default: .claude/ENSEMBLE-HISTORY.md)
 * @param {boolean} [options.autoCommit=true] - Whether to auto-commit
 * @param {boolean} [options.verbose=false] - Enable verbose output
 * @returns {Promise<GenerationResult>}
 */
async function generateHistory(options) {
  const startTime = Date.now();
  const warnings = [];

  // Capture console.warn calls
  const originalWarn = console.warn;
  console.warn = (msg) => {
    if (typeof msg === 'string' && msg.startsWith('[HIST-')) {
      const match = msg.match(/\[([^\]]+)\]\s*(.+)/);
      if (match) {
        warnings.push({ code: match[1], file: '', message: match[2] });
      }
    }
    originalWarn(msg);
  };

  try {
    const docsDir = options.docsDir;
    // Output to .claude/ directory so Claude Code reads it at startup
    const cwd = options.cwd || process.cwd();
    const outputPath = options.outputPath || path.join(cwd, '.claude', 'ENSEMBLE-HISTORY.md');
    const autoCommit = options.autoCommit !== false;
    const verbose = options.verbose || process.env.ENSEMBLE_VERBOSE === 'true';

    if (verbose) {
      console.log(`[DEBUG] Scanning directory: ${docsDir}`);
    }

    // Scan and parse documents
    const { prds, trds } = await scanAndParseDocuments(docsDir);

    if (verbose) {
      console.log(`[DEBUG] Found ${prds.length} PRDs and ${trds.length} TRDs`);
    }

    // Match documents
    const entries = matchDocuments(prds, trds);

    // Calculate stats
    const matchedPairs = entries.filter(e => e.prd && e.trd).length;
    const prdOnly = entries.filter(e => e.prd && !e.trd).length;
    const trdOnly = entries.filter(e => !e.prd && e.trd).length;

    const stats = {
      prdCount: prds.length,
      trdCount: trds.length,
      entryCount: entries.length,
      matchedPairs,
      prdOnly,
      trdOnly
    };

    // Generate markdown
    const markdown = generateMarkdown(entries, stats);

    // Write file
    try {
      await fs.writeFile(outputPath, markdown, 'utf-8');
    } catch (error) {
      throw new HistoryError('HIST-E005', `Failed to write history file: ${outputPath}`, outputPath);
    }

    // Git commit
    let gitCommit = null;
    if (autoCommit) {
      const cwd = path.dirname(docsDir);
      gitCommit = commitHistoryFile(outputPath, stats, cwd);
    }

    // Restore console.warn
    console.warn = originalWarn;

    return {
      success: true,
      outputPath,
      stats,
      warnings,
      gitCommit,
      duration: Date.now() - startTime,
      error: null
    };
  } catch (error) {
    // Restore console.warn
    console.warn = originalWarn;

    return {
      success: false,
      outputPath: options.outputPath || '',
      stats: {
        prdCount: 0,
        trdCount: 0,
        entryCount: 0,
        matchedPairs: 0,
        prdOnly: 0,
        trdOnly: 0
      },
      warnings,
      gitCommit: null,
      duration: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * Print generation result summary to console
 * @param {GenerationResult} result - Generation result
 */
function printSummary(result) {
  console.log('\n=== Phase 4: History Consolidation ===\n');

  if (!result.success) {
    console.log(`✗ Generation failed: ${result.error}`);
    return;
  }

  console.log(`Scanning docs/PRD/... found ${result.stats.prdCount} documents`);
  console.log(`Scanning docs/TRD/... found ${result.stats.trdCount} documents`);
  console.log('');
  console.log('Generated ENSEMBLE-HISTORY.md:');
  console.log(`  - Entries: ${result.stats.entryCount}`);
  console.log(`  - PRDs processed: ${result.stats.prdCount}`);
  console.log(`  - TRDs processed: ${result.stats.trdCount}`);
  console.log(`  - Matched pairs: ${result.stats.matchedPairs}`);
  console.log(`  - PRD only: ${result.stats.prdOnly}`);
  console.log(`  - TRD only: ${result.stats.trdOnly}`);
  console.log('');

  if (result.gitCommit) {
    console.log(`Git: Committed .claude/ENSEMBLE-HISTORY.md`);
    console.log(`  commit ${result.gitCommit} docs(history): update ENSEMBLE-HISTORY.md with latest PRD/TRD changes`);
  } else {
    console.log('Git: No changes to commit');
  }

  console.log(`\nCompleted in ${result.duration}ms`);
}

module.exports = {
  formatTitle,
  matchDocuments,
  generateMarkdown,
  isGitRepository,
  hasChanges,
  commitHistoryFile,
  generateHistory,
  printSummary
};
