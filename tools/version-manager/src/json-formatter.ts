/**
 * JSON formatting options for preserving original file style
 */
export interface FormatOptions {
  indent: string;
  trailingNewline: boolean;
}

/**
 * Detects the formatting style of a JSON string
 * @param jsonString - The original JSON string
 * @returns Format options detected from the string
 */
export function detectFormat(jsonString: string): FormatOptions {
  // Detect trailing newline
  const trailingNewline = jsonString.endsWith('\n');

  // Detect indentation by looking at the first indented line
  const lines = jsonString.split('\n');
  let indent = '  '; // Default to 2 spaces

  for (const line of lines) {
    // Skip empty lines and lines with only opening/closing braces
    if (!line.trim() || line.trim() === '{' || line.trim() === '}') {
      continue;
    }

    // Find leading whitespace
    const match = line.match(/^(\s+)/);
    if (match) {
      const whitespace = match[1];

      // Detect tabs
      if (whitespace.includes('\t')) {
        indent = '\t';
        break;
      }

      // Detect spaces (use the first indented line's spacing)
      if (whitespace.length > 0) {
        indent = whitespace;
        break;
      }
    }
  }

  return {
    indent,
    trailingNewline
  };
}

/**
 * Formats a JavaScript object as JSON with specified formatting options
 * @param obj - The object to format
 * @param options - Formatting options (indent and trailing newline)
 * @returns Formatted JSON string
 */
export function formatJson(obj: any, options: FormatOptions): string {
  // Determine the indentation unit (single level)
  const indentUnit = options.indent;

  // Use JSON.stringify with custom indent
  let formatted = JSON.stringify(obj, null, indentUnit);

  // Add trailing newline if specified
  if (options.trailingNewline && !formatted.endsWith('\n')) {
    formatted += '\n';
  }

  return formatted;
}
