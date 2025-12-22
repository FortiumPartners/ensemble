'use strict';

/**
 * Document Parser Module
 * Parses PRD and TRD markdown files to extract metadata and content summaries.
 *
 * @module document-parser
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * @typedef {Object} ParsedDocument
 * @property {string} filename - Base filename without extension
 * @property {string} filepath - Full path to document
 * @property {'PRD'|'TRD'} type - Document type
 * @property {string|null} id - Document ID (e.g., PRD-CORE-004)
 * @property {string|null} title - Document title
 * @property {string|null} date - Creation date (YYYY-MM-DD)
 * @property {string|null} status - Document status
 * @property {string|null} problem - Problem statement summary
 * @property {string|null} solution - Solution summary
 * @property {string[]} decisions - Key decisions (max 5)
 */

/**
 * Custom error class for history-related errors
 */
class HistoryError extends Error {
  /**
   * @param {string} code - Error code (e.g., HIST-E001)
   * @param {string} message - Error message
   * @param {string|null} filepath - Related file path
   */
  constructor(code, message, filepath = null) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.filepath = filepath;
    this.name = 'HistoryError';
  }
}

/**
 * Scan a directory for markdown files
 * @param {string} dirPath - Directory to scan
 * @returns {Promise<string[]>} Array of file paths
 * @throws {HistoryError} If directory cannot be scanned
 */
async function scanDirectory(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const mdFiles = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => path.join(dirPath, entry.name));
    return mdFiles;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Directory doesn't exist - return empty array with warning
      console.warn(`[HIST-W001] No directory found: ${dirPath}`);
      return [];
    }
    throw new HistoryError('HIST-E001', `Failed to scan directory: ${dirPath}`, dirPath);
  }
}

/**
 * Extract date from document content with multiple fallback strategies
 * @param {string} content - Document content
 * @param {string} filepath - Path to file (for fallback)
 * @returns {Promise<string|null>} Date in YYYY-MM-DD format or null
 */
async function extractDate(content, filepath) {
  // Strategy 1: Metadata table "| **Created** | 2025-12-22 |"
  const tableMatch = content.match(/\|\s*\*\*Created\*\*\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/);
  if (tableMatch) return tableMatch[1];

  // Strategy 2: Inline "Created: 2025-12-22"
  const inlineMatch = content.match(/Created:\s*(\d{4}-\d{2}-\d{2})/i);
  if (inlineMatch) return inlineMatch[1];

  // Strategy 3: First date pattern in document
  const anyDateMatch = content.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (anyDateMatch) return anyDateMatch[1];

  // Strategy 4: File modification time (fallback)
  try {
    const stats = await fs.stat(filepath);
    console.warn(`[HIST-W003] Using file date for: ${path.basename(filepath)}`);
    return stats.mtime.toISOString().split('T')[0];
  } catch (error) {
    return null;
  }
}

/**
 * Extract document ID from content
 * @param {string} content - Document content
 * @param {'PRD'|'TRD'} type - Document type
 * @returns {string|null} Document ID or null
 */
function extractId(content, type) {
  // Look for ID in metadata table: "| **PRD ID** | PRD-CORE-004 |"
  const idPattern = new RegExp(`\\|\\s*\\*\\*${type}\\s*ID\\*\\*\\s*\\|\\s*([^|]+)\\s*\\|`, 'i');
  const match = content.match(idPattern);
  if (match) return match[1].trim();

  // Look for ID pattern anywhere: PRD-CORE-004 or TRD-CORE-004
  const anyIdMatch = content.match(new RegExp(`(${type}-[A-Z]+-\\d+)`, 'i'));
  if (anyIdMatch) return anyIdMatch[1].toUpperCase();

  return null;
}

/**
 * Extract document title from content
 * @param {string} content - Document content
 * @returns {string|null} Document title or null
 */
function extractTitle(content) {
  // Strategy 1: First H1 heading
  const h1Match = content.match(/^#\s+(?:(?:Product|Technical)\s+Requirements\s+Document:\s*)?(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Strategy 2: Feature field in metadata table
  const featureMatch = content.match(/\|\s*\*\*Feature\*\*\s*\|\s*([^|]+)\s*\|/);
  if (featureMatch) return featureMatch[1].trim();

  return null;
}

/**
 * Extract document status from content
 * @param {string} content - Document content
 * @returns {string|null} Document status or null
 */
function extractStatus(content) {
  // Look for Status in metadata table
  const statusMatch = content.match(/\|\s*\*\*Status\*\*\s*\|\s*([^|]+)\s*\|/);
  if (statusMatch) return statusMatch[1].trim();

  return null;
}

/**
 * Maximum character length for problem/solution summaries
 */
const MAX_SUMMARY_LENGTH = 300;

/**
 * Extract problem statement summary from content
 * @param {string} content - Document content
 * @returns {string|null} Problem summary (max 300 chars) or null
 */
function extractProblem(content) {
  // Look for Problem Statement section
  const problemMatch = content.match(
    /###?\s*(?:\d+\.\d+\s*)?Problem\s*(?:Statement)?\s*\n+([\s\S]*?)(?=\n###?|\n##|$)/i
  );

  if (problemMatch) {
    const sectionContent = problemMatch[1].trim();
    const paragraphs = sectionContent.split('\n\n');

    // Get first paragraph
    let firstPara = paragraphs[0].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

    // If first paragraph ends with colon, it's introducing a list - extract key points
    if (firstPara.endsWith(':') && paragraphs.length > 1) {
      // Extract bold items from the list (e.g., "1. **No Consolidated History**:")
      const listItems = [];
      const boldMatches = sectionContent.match(/\*\*([^*]+)\*\*/g);
      if (boldMatches) {
        boldMatches.slice(0, 4).forEach(m => {
          const text = m.replace(/\*\*/g, '').trim();
          if (text.length < 50) listItems.push(text);
        });
      }

      if (listItems.length > 0) {
        // Combine intro with key points
        const intro = firstPara.replace(/:$/, '');
        const result = `${intro}: ${listItems.join(', ')}.`;
        if (result.length > MAX_SUMMARY_LENGTH) {
          console.warn(`[HIST-W004] Truncated content in problem extraction`);
          return result.slice(0, MAX_SUMMARY_LENGTH - 3) + '...';
        }
        return result;
      }
    }

    // Remove leading numbers/bullets
    firstPara = firstPara.replace(/^[\d\.\-\*]+\s*/, '');

    if (firstPara.length > MAX_SUMMARY_LENGTH) {
      console.warn(`[HIST-W004] Truncated content in problem extraction`);
      return firstPara.slice(0, MAX_SUMMARY_LENGTH - 3) + '...';
    }
    return firstPara || null;
  }

  return null;
}

/**
 * Extract solution overview summary from content
 * @param {string} content - Document content
 * @returns {string|null} Solution summary (max 300 chars) or null
 */
function extractSolution(content) {
  // Look for Solution/Solution Overview/Technical Approach section
  const solutionMatch = content.match(
    /###?\s*(?:\d+\.\d+\s*)?(?:Solution|Technical\s*Approach)\s*(?:Overview)?\s*\n+([\s\S]*?)(?=\n###?|\n##|$)/i
  );

  if (solutionMatch) {
    const sectionContent = solutionMatch[1].trim();
    const paragraphs = sectionContent.split('\n\n');

    // Get first paragraph
    let firstPara = paragraphs[0].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

    // If first paragraph ends with colon, it's introducing a list - extract key points
    if (firstPara.endsWith(':') && paragraphs.length > 1) {
      // Extract bold items from the list
      const listItems = [];
      const boldMatches = sectionContent.match(/\*\*([^*]+)\*\*/g);
      if (boldMatches) {
        boldMatches.slice(0, 4).forEach(m => {
          const text = m.replace(/\*\*/g, '').trim();
          if (text.length < 50) listItems.push(text);
        });
      }

      if (listItems.length > 0) {
        // Combine intro with key points
        const intro = firstPara.replace(/:$/, '');
        const result = `${intro}: ${listItems.join(', ')}.`;
        if (result.length > MAX_SUMMARY_LENGTH) {
          console.warn(`[HIST-W004] Truncated content in solution extraction`);
          return result.slice(0, MAX_SUMMARY_LENGTH - 3) + '...';
        }
        return result;
      }
    }

    // Remove leading numbers/bullets
    firstPara = firstPara.replace(/^[\d\.\-\*]+\s*/, '');

    if (firstPara.length > MAX_SUMMARY_LENGTH) {
      console.warn(`[HIST-W004] Truncated content in solution extraction`);
      return firstPara.slice(0, MAX_SUMMARY_LENGTH - 3) + '...';
    }
    return firstPara || null;
  }

  return null;
}

/**
 * Extract key decisions from content
 * @param {string} content - Document content
 * @returns {string[]} Array of key decisions (max 5)
 */
function extractDecisions(content) {
  const decisions = [];

  // Strategy 1: Key Decisions Summary table (PRD format)
  const summaryTableMatch = content.match(
    /Key\s*Decisions?\s*Summary\s*\n+[\s\S]*?\|[^\n]+\|\s*\n\|[-|\s]+\|\s*\n([\s\S]*?)(?=\n---|\n##|$)/i
  );

  if (summaryTableMatch) {
    const rows = summaryTableMatch[1].match(/\|\s*\*\*([^|*]+)\*\*\s*\|/g);
    if (rows) {
      rows.slice(0, 5).forEach(row => {
        const match = row.match(/\*\*([^*]+)\*\*/);
        if (match) decisions.push(match[1].trim());
      });
    }
  }

  // Strategy 2: Key Architectural Decisions table (TRD format)
  if (decisions.length === 0) {
    const archTableMatch = content.match(
      /Key\s*Architectural\s*Decisions?\s*\n+\|[^\n]+\|\s*\n\|[-|\s]+\|\s*\n([\s\S]*?)(?=\n---|\n##|$)/i
    );

    if (archTableMatch) {
      const rows = archTableMatch[1].match(/\|\s*\*\*([^|*]+)\*\*\s*\|/g);
      if (rows) {
        rows.slice(0, 5).forEach(row => {
          const match = row.match(/\*\*([^*]+)\*\*/);
          if (match) decisions.push(match[1].trim());
        });
      }
    }
  }

  // Strategy 3: Bullet list under decisions header
  if (decisions.length === 0) {
    const listMatch = content.match(
      /(?:Key\s*)?Decisions?\s*\n+((?:[-*]\s+[^\n]+\n?)+)/i
    );
    if (listMatch) {
      const bullets = listMatch[1].match(/[-*]\s+([^\n]+)/g);
      if (bullets) {
        bullets.slice(0, 5).forEach(bullet => {
          decisions.push(bullet.replace(/^[-*]\s+/, '').trim());
        });
      }
    }
  }

  // Strategy 4: Core Technical Decisions section (TRD format)
  if (decisions.length === 0) {
    const coreDecisionsMatch = content.match(
      /Core\s*Technical\s*Decisions:\s*\n+((?:[-*]\s+[^\n]+\n?)+)/i
    );
    if (coreDecisionsMatch) {
      const bullets = coreDecisionsMatch[1].match(/[-*]\s+\*\*([^*]+)\*\*/g);
      if (bullets) {
        bullets.slice(0, 5).forEach(bullet => {
          const match = bullet.match(/\*\*([^*]+)\*\*/);
          if (match) decisions.push(match[1].trim());
        });
      }
    }
  }

  return decisions;
}

/**
 * Parse a PRD or TRD markdown file
 * @param {string} filepath - Path to markdown file
 * @param {'PRD'|'TRD'} type - Document type
 * @returns {Promise<ParsedDocument>} Parsed document object
 * @throws {HistoryError} If file cannot be parsed
 */
async function parseDocument(filepath, type) {
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const filename = path.basename(filepath, '.md');

    const date = await extractDate(content, filepath);
    const id = extractId(content, type);
    const title = extractTitle(content);
    const status = extractStatus(content);
    const problem = extractProblem(content);
    const solution = extractSolution(content);
    const decisions = extractDecisions(content);

    // Warn if missing critical metadata
    if (!date && !title) {
      console.warn(`[HIST-E003] Missing required metadata in: ${filepath}`);
    }

    return {
      filename,
      filepath,
      type,
      id,
      title,
      date,
      status,
      problem,
      solution,
      decisions
    };
  } catch (error) {
    if (error instanceof HistoryError) throw error;
    throw new HistoryError('HIST-E002', `Failed to parse document: ${filepath}`, filepath);
  }
}

/**
 * Scan and parse all documents in PRD and TRD directories
 * @param {string} docsDir - Path to docs directory
 * @returns {Promise<{prds: ParsedDocument[], trds: ParsedDocument[]}>}
 */
async function scanAndParseDocuments(docsDir) {
  const prdDir = path.join(docsDir, 'PRD');
  const trdDir = path.join(docsDir, 'TRD');

  // Scan directories
  const prdFiles = await scanDirectory(prdDir);
  const trdFiles = await scanDirectory(trdDir);

  if (prdFiles.length === 0) {
    console.warn(`[HIST-W001] No PRDs found in ${prdDir}`);
  }
  if (trdFiles.length === 0) {
    console.warn(`[HIST-W002] No TRDs found in ${trdDir}`);
  }

  // Parse all documents
  const prds = [];
  const trds = [];

  for (const filepath of prdFiles) {
    try {
      const doc = await parseDocument(filepath, 'PRD');
      prds.push(doc);
    } catch (error) {
      console.error(error.message);
      // Continue with other documents
    }
  }

  for (const filepath of trdFiles) {
    try {
      const doc = await parseDocument(filepath, 'TRD');
      trds.push(doc);
    } catch (error) {
      console.error(error.message);
      // Continue with other documents
    }
  }

  return { prds, trds };
}

module.exports = {
  HistoryError,
  scanDirectory,
  extractDate,
  extractId,
  extractTitle,
  extractStatus,
  extractProblem,
  extractSolution,
  extractDecisions,
  parseDocument,
  scanAndParseDocuments
};
