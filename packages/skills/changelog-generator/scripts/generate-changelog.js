/**
 * Changelog Generator Script
 *
 * Generates changelog from conventional commits with categorization.
 *
 * @module generate-changelog
 * @version 1.0.0
 */

const { performance } = require('perf_hooks');
const { execSync } = require('child_process');

/**
 * Conventional Commit Parser
 */
class ConventionalCommitParser {
  constructor() {
    this.typeRegex = /^(\w+)(?:\(([^)]+)\))?(!)?:\s(.+)$/;
    this.breakingRegex = /BREAKING CHANGE:\s*(.+)/;
  }

  /**
   * Parse a single commit message
   *
   * @param {string} message - Commit message
   * @param {string} hash - Commit hash
   * @param {string} author - Commit author
   * @returns {Object} Parsed commit
   */
  parse(message, hash = '', author = '') {
    if (!message || typeof message !== 'string') {
      return {
        type: 'other',
        scope: null,
        subject: 'Invalid commit message',
        body: '',
        breaking: false,
        hash,
        author,
        raw: message || '',
        isConventional: false
      };
    }

    const lines = message.split('\n');
    const firstLine = lines[0];
    const match = firstLine.match(this.typeRegex);

    if (!match) {
      return {
        type: 'other',
        scope: null,
        subject: firstLine,
        body: lines.slice(1).join('\n'),
        breaking: false,
        hash,
        author,
        raw: message,
        isConventional: false
      };
    }

    const [, type, scope, exclamation, subject] = match;
    const body = lines.slice(1).join('\n');
    const breakingMatch = body.match(this.breakingRegex);

    return {
      type: type.toLowerCase(),
      scope: scope || null,
      subject,
      body,
      breaking: exclamation === '!' || breakingMatch !== null,
      breakingChangeDescription: breakingMatch ? breakingMatch[1] : null,
      hash,
      author,
      raw: message,
      isConventional: true
    };
  }

  /**
   * Extract references (issue numbers) from commit
   *
   * @param {string} message - Commit message
   * @returns {Array<string>} Issue references
   */
  extractReferences(message) {
    const refRegex = /#(\d+)/g;
    const matches = [...message.matchAll(refRegex)];
    return matches.map(m => `#${m[1]}`);
  }
}

/**
 * Changelog Category Manager
 */
class CategoryManager {
  constructor(config = {}) {
    this.typeMapping = config.typeMapping || {
      feat: 'Features',
      fix: 'Bug Fixes',
      perf: 'Performance',
      docs: 'Documentation',
      refactor: 'Code Quality',
      test: 'Testing',
      build: 'Build System',
      ci: 'CI/CD',
      chore: 'Maintenance',
      revert: 'Reverts',
      style: 'Code Style'
    };

    this.categoryPriority = [
      'Breaking Changes',
      'Features',
      'Bug Fixes',
      'Performance',
      'Documentation',
      'Code Quality',
      'Testing',
      'Build System',
      'CI/CD',
      'Maintenance',
      'Reverts',
      'Code Style',
      'Other Changes'
    ];

    this.excludeTypes = config.excludeTypes || ['style', 'ci', 'chore'];
  }

  /**
   * Get category for commit
   *
   * @param {Object} commit - Parsed commit
   * @returns {string} Category name
   */
  getCategory(commit) {
    if (commit.breaking) {
      return 'Breaking Changes';
    }

    if (!commit.isConventional) {
      return 'Other Changes';
    }

    return this.typeMapping[commit.type] || 'Other Changes';
  }

  /**
   * Check if commit type should be excluded
   *
   * @param {Object} commit - Parsed commit
   * @returns {boolean} True if should exclude
   */
  shouldExclude(commit) {
    return this.excludeTypes.includes(commit.type);
  }

  /**
   * Sort categories by priority
   *
   * @param {Array<string>} categories - Category names
   * @returns {Array<string>} Sorted categories
   */
  sortCategories(categories) {
    return categories.sort((a, b) => {
      const aIndex = this.categoryPriority.indexOf(a);
      const bIndex = this.categoryPriority.indexOf(b);

      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;

      return aIndex - bIndex;
    });
  }
}

/**
 * Semantic Version Suggester
 */
class VersionSuggester {
  /**
   * Suggest next version based on commits
   *
   * @param {string} currentVersion - Current semantic version
   * @param {Array<Object>} commits - Parsed commits
   * @returns {Object} Version suggestion
   */
  suggest(currentVersion, commits) {
    const breakdown = {
      breaking: commits.filter(c => c.breaking).length,
      features: commits.filter(c => c.type === 'feat' && !c.breaking).length,
      fixes: commits.filter(c => c.type === 'fix').length,
      other: commits.filter(c => c.type !== 'feat' && c.type !== 'fix' && !c.breaking).length
    };

    const [major, minor, patch] = currentVersion.replace(/^v/, '').split('.').map(Number);

    let suggestedVersion;
    let bumpType;

    if (breakdown.breaking > 0) {
      suggestedVersion = `${major + 1}.0.0`;
      bumpType = 'major';
    } else if (breakdown.features > 0) {
      suggestedVersion = `${major}.${minor + 1}.0`;
      bumpType = 'minor';
    } else if (breakdown.fixes > 0) {
      suggestedVersion = `${major}.${minor}.${patch + 1}`;
      bumpType = 'patch';
    } else {
      suggestedVersion = currentVersion.replace(/^v/, '');
      bumpType = 'none';
    }

    return {
      currentVersion: currentVersion.replace(/^v/, ''),
      suggestedVersion,
      bumpType,
      reason: this.buildReason(breakdown),
      breakdown
    };
  }

  buildReason(breakdown) {
    const parts = [];
    if (breakdown.breaking > 0) parts.push(`${breakdown.breaking} breaking change${breakdown.breaking > 1 ? 's' : ''}`);
    if (breakdown.features > 0) parts.push(`${breakdown.features} feature${breakdown.features > 1 ? 's' : ''}`);
    if (breakdown.fixes > 0) parts.push(`${breakdown.fixes} fix${breakdown.fixes > 1 ? 'es' : ''}`);

    return parts.length > 0 ? parts.join(', ') : 'No significant changes';
  }
}

/**
 * Changelog Generator
 */
class ChangelogGenerator {
  constructor(config = {}) {
    this.config = {
      fromTag: config.fromTag || null,
      toTag: config.toTag || 'HEAD',
      format: config.format || 'markdown',
      includeCommitHash: config.includeCommitHash !== false,
      includeAuthor: config.includeAuthor || false,
      groupByScope: config.groupByScope || false,
      currentVersion: config.currentVersion || '0.0.0',
      ...config
    };

    this.parser = new ConventionalCommitParser();
    this.categoryManager = new CategoryManager(config);
    this.versionSuggester = new VersionSuggester();

    this.commits = [];
    this.categorized = {};
  }

  /**
   * Fetch commits from git
   *
   * @returns {Array<Object>} Git commits
   */
  fetchCommits() {
    try {
      const range = this.config.fromTag
        ? `${this.config.fromTag}..${this.config.toTag}`
        : this.config.toTag;

      const format = '%H|%s|%b|%an';
      const cmd = `git log ${range} --format="${format}" --no-merges`;

      const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

      if (!output.trim()) {
        return [];
      }

      const commits = output.trim().split('\n').map(line => {
        const [hash, subject, body, author] = line.split('|');
        const message = body ? `${subject}\n${body}` : subject;

        return {
          hash: hash.substring(0, 7),
          message,
          author
        };
      });

      return commits;

    } catch (error) {
      console.error(`Failed to fetch commits: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse and categorize commits
   *
   * @param {Array<Object>} commits - Raw commits from git
   * @returns {Object} Categorized commits
   */
  parseAndCategorize(commits) {
    const categorized = {};

    for (const commit of commits) {
      const parsed = this.parser.parse(commit.message, commit.hash, commit.author);

      if (this.categoryManager.shouldExclude(parsed)) {
        continue;
      }

      const category = this.categoryManager.getCategory(parsed);

      if (!categorized[category]) {
        categorized[category] = [];
      }

      categorized[category].push(parsed);
    }

    return categorized;
  }

  /**
   * Format changelog as Markdown
   *
   * @param {Object} categorized - Categorized commits
   * @param {Object} versionInfo - Version information
   * @returns {string} Markdown changelog
   */
  formatMarkdown(categorized, versionInfo) {
    const lines = [];
    const date = new Date().toISOString().split('T')[0];

    lines.push(`## [${versionInfo.suggestedVersion}] - ${date}`);
    lines.push('');

    const categories = this.categoryManager.sortCategories(Object.keys(categorized));

    for (const category of categories) {
      const commits = categorized[category];

      if (commits.length === 0) continue;

      lines.push(`### ${category}`);

      for (const commit of commits) {
        const scope = commit.scope ? `**${commit.scope}**: ` : '';
        const hash = this.config.includeCommitHash ? ` (${commit.hash})` : '';
        lines.push(`- ${scope}${commit.subject}${hash}`);

        if (commit.breaking && commit.breakingChangeDescription) {
          lines.push('');
          lines.push(`  ${commit.breakingChangeDescription}`);
          lines.push('');
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format changelog as JSON
   *
   * @param {Object} categorized - Categorized commits
   * @param {Object} versionInfo - Version information
   * @returns {string} JSON changelog
   */
  formatJSON(categorized, versionInfo) {
    const date = new Date().toISOString().split('T')[0];

    const changes = Object.entries(categorized).map(([category, commits]) => ({
      category,
      commits: commits.map(c => ({
        type: c.type,
        scope: c.scope,
        subject: c.subject,
        hash: c.hash,
        breaking: c.breaking,
        body: c.body || null
      }))
    }));

    return JSON.stringify({
      version: versionInfo.suggestedVersion,
      date,
      versionInfo,
      changes
    }, null, 2);
  }

  /**
   * Format changelog as plain text
   *
   * @param {Object} categorized - Categorized commits
   * @param {Object} versionInfo - Version information
   * @returns {string} Plain text changelog
   */
  formatPlainText(categorized, versionInfo) {
    const lines = [];
    const date = new Date().toISOString().split('T')[0];

    lines.push(`Release ${versionInfo.suggestedVersion} - ${date}`);
    lines.push('');

    const categories = this.categoryManager.sortCategories(Object.keys(categorized));

    for (const category of categories) {
      const commits = categorized[category];

      if (commits.length === 0) continue;

      lines.push(category.toUpperCase() + ':');

      for (const commit of commits) {
        const scope = commit.scope ? `${commit.scope}: ` : '';
        const hash = this.config.includeCommitHash ? ` (${commit.hash})` : '';
        lines.push(`* ${scope}${commit.subject}${hash}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate changelog
   *
   * @returns {Promise<string>} Generated changelog
   */
  async generate() {
    const startTime = performance.now();

    // Fetch commits from git
    const rawCommits = this.fetchCommits();

    // Parse and categorize
    this.commits = rawCommits.map(c => this.parser.parse(c.message, c.hash, c.author));
    this.categorized = this.parseAndCategorize(rawCommits);

    // Suggest version
    const versionInfo = this.versionSuggester.suggest(this.config.currentVersion, this.commits);

    // Format output
    let changelog;
    switch (this.config.format) {
      case 'json':
        changelog = this.formatJSON(this.categorized, versionInfo);
        break;
      case 'plain':
        changelog = this.formatPlainText(this.categorized, versionInfo);
        break;
      case 'markdown':
      default:
        changelog = this.formatMarkdown(this.categorized, versionInfo);
        break;
    }

    const duration = Math.round(performance.now() - startTime);

    return {
      changelog,
      versionInfo,
      stats: {
        totalCommits: rawCommits.length,
        parsedCommits: this.commits.length,
        categoriesCount: Object.keys(this.categorized).length,
        duration
      }
    };
  }

  /**
   * Suggest next semantic version
   *
   * @returns {Object} Version suggestion
   */
  suggestVersion() {
    return this.versionSuggester.suggest(this.config.currentVersion, this.commits);
  }
}

module.exports = {
  ChangelogGenerator,
  ConventionalCommitParser,
  CategoryManager,
  VersionSuggester
};

/**
 * CLI usage example:
 *
 * const { ChangelogGenerator } = require('./generate-changelog.js');
 *
 * const generator = new ChangelogGenerator({
 *   fromTag: 'v2.0.0',
 *   toTag: 'HEAD',
 *   format: 'markdown',
 *   currentVersion: '2.0.0'
 * });
 *
 * const result = await generator.generate();
 * console.log(result.changelog);
 * console.log(`Suggested version: ${result.versionInfo.suggestedVersion}`);
 */
