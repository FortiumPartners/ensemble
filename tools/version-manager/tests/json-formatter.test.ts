import { detectFormat, formatJson, FormatOptions } from '../src/json-formatter';

describe('JSON Formatter', () => {
  describe('detectFormat', () => {
    it('should detect 2-space indentation', () => {
      const json = `{
  "name": "test",
  "version": "1.0.0"
}`;
      const format = detectFormat(json);
      expect(format.indent).toBe('  ');
    });

    it('should detect 4-space indentation', () => {
      const json = `{
    "name": "test",
    "version": "1.0.0"
}`;
      const format = detectFormat(json);
      expect(format.indent).toBe('    ');
    });

    it('should detect tab indentation', () => {
      const json = `{
\t"name": "test",
\t"version": "1.0.0"
}`;
      const format = detectFormat(json);
      expect(format.indent).toBe('\t');
    });

    it('should detect trailing newline', () => {
      const json = `{
  "name": "test"
}\n`;
      const format = detectFormat(json);
      expect(format.trailingNewline).toBe(true);
    });

    it('should detect no trailing newline', () => {
      const json = `{
  "name": "test"
}`;
      const format = detectFormat(json);
      expect(format.trailingNewline).toBe(false);
    });

    it('should default to 2-space indent for minified JSON', () => {
      const json = '{"name":"test","version":"1.0.0"}';
      const format = detectFormat(json);
      expect(format.indent).toBe('  ');
      expect(format.trailingNewline).toBe(false);
    });

    it('should handle empty JSON', () => {
      const json = '{}';
      const format = detectFormat(json);
      expect(format.indent).toBe('  ');
      expect(format.trailingNewline).toBe(false);
    });
  });

  describe('formatJson', () => {
    it('should format with 2-space indentation', () => {
      const obj = { name: 'test', version: '1.0.0' };
      const options: FormatOptions = { indent: '  ', trailingNewline: false };
      const result = formatJson(obj, options);

      expect(result).toBe(`{
  "name": "test",
  "version": "1.0.0"
}`);
    });

    it('should format with 4-space indentation', () => {
      const obj = { name: 'test', version: '1.0.0' };
      const options: FormatOptions = { indent: '    ', trailingNewline: false };
      const result = formatJson(obj, options);

      expect(result).toBe(`{
    "name": "test",
    "version": "1.0.0"
}`);
    });

    it('should format with tab indentation', () => {
      const obj = { name: 'test', version: '1.0.0' };
      const options: FormatOptions = { indent: '\t', trailingNewline: false };
      const result = formatJson(obj, options);

      expect(result).toBe(`{
\t"name": "test",
\t"version": "1.0.0"
}`);
    });

    it('should add trailing newline when specified', () => {
      const obj = { name: 'test' };
      const options: FormatOptions = { indent: '  ', trailingNewline: true };
      const result = formatJson(obj, options);

      expect(result).toBe(`{
  "name": "test"
}\n`);
    });

    it('should not add trailing newline when not specified', () => {
      const obj = { name: 'test' };
      const options: FormatOptions = { indent: '  ', trailingNewline: false };
      const result = formatJson(obj, options);

      expect(result.endsWith('\n')).toBe(false);
    });

    it('should handle nested objects', () => {
      const obj = {
        name: 'test',
        author: {
          name: 'John Doe',
          email: 'john@example.com'
        }
      };
      const options: FormatOptions = { indent: '  ', trailingNewline: false };
      const result = formatJson(obj, options);

      expect(result).toBe(`{
  "name": "test",
  "author": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}`);
    });

    it('should handle arrays', () => {
      const obj = {
        name: 'test',
        keywords: ['one', 'two', 'three']
      };
      const options: FormatOptions = { indent: '  ', trailingNewline: false };
      const result = formatJson(obj, options);

      expect(result).toContain('"keywords": [\n    "one"');
    });
  });

  describe('format preservation roundtrip', () => {
    it('should preserve original formatting', () => {
      const original = `{
  "name": "test",
  "version": "1.0.0",
  "author": {
    "name": "John Doe"
  }
}\n`;

      const format = detectFormat(original);
      const obj = JSON.parse(original);
      const formatted = formatJson(obj, format);

      expect(formatted).toBe(original);
    });

    it('should preserve 4-space formatting', () => {
      const original = `{
    "name": "test",
    "version": "1.0.0"
}`;

      const format = detectFormat(original);
      const obj = JSON.parse(original);
      const formatted = formatJson(obj, format);

      expect(formatted).toBe(original);
    });

    it('should preserve tab formatting', () => {
      const original = `{
\t"name": "test",
\t"version": "1.0.0"
}\n`;

      const format = detectFormat(original);
      const obj = JSON.parse(original);
      const formatted = formatJson(obj, format);

      expect(formatted).toBe(original);
    });
  });
});
