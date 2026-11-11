/**
 * Agent Skills spec: a SKILL.md `description` is at most 1024 characters.
 *
 * capDescription cuts an over-long wrapper description at a sentence boundary (else a
 * word boundary) and leaves a description within the limit byte-identical. The wrapper
 * body must still carry the full Mission text the description was derived from.
 */

import * as path from 'path';
import matter from 'gray-matter';
import {
  MAX_DESCRIPTION_LENGTH,
  capDescription,
  generateCommandSkills,
} from '../src/transformers/command-skill-transformer';

const sentence = (i: number) => `Sentence number ${i} explains one more detail of the long workflow.`;
const sentences = (n: number) => Array.from({ length: n }, (_, i) => sentence(i + 1)).join(' ');

describe('capDescription', () => {
  it('returns a description within the limit unchanged', () => {
    const short = 'A short mission. It has two sentences.';
    expect(capDescription(short)).toBe(short);

    const exact = 'x'.repeat(MAX_DESCRIPTION_LENGTH);
    expect(capDescription(exact)).toBe(exact);
  });

  it('cuts an over-long description at the last whole sentence that fits', () => {
    const long = sentences(30);
    expect(long.length).toBeGreaterThan(MAX_DESCRIPTION_LENGTH);

    const capped = capDescription(long);
    expect(capped.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(capped.endsWith('.')).toBe(true);
    expect(long.startsWith(capped)).toBe(true);
    // A whole sentence boundary: the next character of the source is the separator space,
    // and the cut kept as many whole sentences as fit (the next one would overflow).
    expect(long[capped.length]).toBe(' ');
    const next = long.slice(capped.length + 1).match(/^[^.]*\./)![0];
    expect(capped.length + 1 + next.length).toBeGreaterThan(MAX_DESCRIPTION_LENGTH);
  });

  it('keeps a sentence that ends exactly at the limit', () => {
    const head = 'a'.repeat(MAX_DESCRIPTION_LENGTH - 1) + '.';
    const capped = capDescription(`${head} Trailing sentence.`);
    expect(capped).toBe(head);
  });

  it('falls back to a word boundary when there is no sentence end to cut at', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    expect(words.length).toBeGreaterThan(MAX_DESCRIPTION_LENGTH);

    const capped = capDescription(words);
    expect(capped.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(words.startsWith(capped)).toBe(true);
    expect(capped.endsWith(' ')).toBe(false);
    // Whole words only: the cut lands on a space of the source.
    expect(words[capped.length]).toBe(' ');
  });

  it('hard-cuts at the limit when there is no boundary at all', () => {
    const capped = capDescription('x'.repeat(MAX_DESCRIPTION_LENGTH + 50));
    expect(capped).toHaveLength(MAX_DESCRIPTION_LENGTH);
  });
});

describe('generateCommandSkills description cap', () => {
  const fixtureRoot = path.join(__dirname, 'fixtures', 'command-skill-description');

  it('caps an over-long Mission in the frontmatter, keeps it whole in the body, leaves a short one unchanged', async () => {
    const results = await generateCommandSkills(fixtureRoot, { dryRun: true });
    const byName = (name: string) => {
      const hit = results.find((r) => r.outputPath.includes(`${path.sep}${name}${path.sep}`));
      expect(hit).toBeDefined();
      return matter(hit!.content);
    };

    const long = byName('ensemble-long');
    const description = String(long.data['description']);
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(description.endsWith('.')).toBe(true);
    expect(long.content).toContain(sentences(30));

    const short = byName('ensemble-short');
    expect(short.data['description']).toBe('A short mission. It has two sentences.');
  });
});
