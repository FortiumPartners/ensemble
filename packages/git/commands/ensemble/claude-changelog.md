---
name: ensemble:claude-changelog
description: Track Claude updates and new features directly from your development environment.
Fetch, parse, and display changelogs with intelligent filtering and caching.

---
<!-- DO NOT EDIT - Generated from claude-changelog.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


This command fetches and displays Claude changelog information from Anthropic documentation.
It provides intelligent filtering by version, date, category, and importance level.
Results are cached for 24 hours to optimize performance.

## Workflow

### Phase 1: Parameter Parsing

**1. Validate Parameters**
   Parse and validate command parameters

   - Parse command-line arguments
   - Validate version format (semver)
   - Validate date format (YYYY-MM-DD or relative)
   - Validate category names
   - Validate output format

**2. Handle Help Flag**
   Display help if requested

   - Check if --help flag is set
   - Return comprehensive help text if true
   - Continue to workflow if false

### Phase 2: Data Fetching

**1. Check Cache**
   Check for cached changelog data

   - Skip cache if --refresh flag is set
   - Check cache directory ~/.ensemble/cache/changelog/
   - Verify cache TTL (24 hours)
   - Return cached data if fresh

**2. Fetch from Network**
   Fetch changelog from Anthropic documentation

   - Attempt WebFetch MCP integration (if available)
   - Fall back to Node.js HTTPS module
   - Apply 5-second timeout
   - Retry with exponential backoff (max 2 retries)
   - Handle network errors gracefully

**3. Cache Response**
   Store fetched data in cache

   - Create cache directory if needed
   - Write JSON cache file with TTL metadata
   - Handle cache write errors (non-critical)

### Phase 3: Parsing & Categorization

**1. Parse HTML Content**
   Extract structured data from changelog HTML

   - Parse HTML with cheerio
   - Extract version (semver format)
   - Extract release date (ISO 8601)
   - Identify section headers (7 categories)
   - Extract feature descriptions

**2. Categorize Features**
   Classify and enhance feature data

   - Categorize by type (breaking, new, etc.)
   - Assess impact level (high, medium, low)
   - Calculate confidence score
   - Extract migration guidance for breaking changes

**3. Validate Data**
   Validate and enrich parsed data

   - Validate version format (semver)
   - Validate date format (ISO 8601)
   - Add metadata (cachedAt, source, confidence)
   - Handle partial parsing results

### Phase 4: Filtering & Formatting

**1. Apply Filters**
   Filter features based on parameters

   - Filter by category if specified
   - Filter by importance (high impact only)
   - Filter by date range if --since specified
   - Sort by impact and category

**2. Format Output**
   Generate formatted output

   - Create formatter with specified format (console/json/markdown)
   - Generate formatted output with symbols and colors
   - Add summary statistics
   - Include high-impact indicators

**3. Display Result**
   Return formatted changelog to user

   - Return formatted output string
   - Include cache metadata if applicable
   - Display partial results warning if needed

## Usage

```
/ensemble:claude-changelog
```
