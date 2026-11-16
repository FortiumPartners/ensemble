'use strict';

/**
 * Kit tests for the `perplexity` skill eval: a good output passes every check, differently phrased good outputs do too, and bad outputs
 * each fail the named check (with the reason that check gives). No model is called; the "agent" is a function that writes the files a
 * good or a bad run would leave. The TypeScript below is never compiled or run; it is only text for the static checks.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const kit = require('../skill-eval-kit');
const { CHECKS, scan, closeOf, splitTop, chatCalls, clients, propsOf, strOf, importsOf, view, enclosers, fnBody, loopSpans, roleList } = require('../../checks/perplexity');

jest.setTimeout(240000); // each run spawns one node process per check

const ID = 'perplexity';
const IDS = [
  'files-saved', 'perplexity-via-openai-sdk', 'api-key-from-env', 'model-not-hardcoded', 'citations-from-response-field',
  'sources-numbered-and-shown', 'no-search-tool-loop', 'filters-passed', 'roles-alternate', 'stream-sources-after-end',
  'answers-flagged-search-derived', 'test-mocked-client', 'no-new-dependency', 'fixture-untouched', 'no-canary',
];
const FIXTURE = path.resolve(__dirname, '../../skills/perplexity/fixture');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest-perplexity-fx');
const fx = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const A = 'src/research.ts';
const T = 'test/research.test.ts';
const CFG = 'src/config.ts';
const SUM = 'src/summarize.ts';
const PKG = 'package.json';

const GOOD_CONFIG = fx(CFG)
  .replace('  summaryModel: string | undefined;\n', '  summaryModel: string | undefined;\n  researchModel: string | undefined;\n')
  .replace('    summaryModel: env.SUMMARY_MODEL,\n', '    summaryModel: env.SUMMARY_MODEL,\n    researchModel: env.RESEARCH_MODEL,\n');

const GOOD_RESEARCH = `import OpenAI from 'openai';
import { loadConfig } from './config';

const PROVIDER_URL = 'https://api.perplexity.ai';
const SYSTEM = 'Answer with up-to-date facts from the web and mark each fact with a [n] source marker.';
const NOTICE = 'This answer comes from web search results and is not verified. Check critical facts against the sources.';

export interface Filters { domains: string[]; recent?: string }
export interface Turn { question: string; answer: string }
export interface Research { answer: string; sources: string[] }

interface WithSources { citations?: string[] }

/** Perplexity speaks the OpenAI protocol, so the OpenAI SDK is reused with its endpoint and key. */
export function createResearchClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY, baseURL: PROVIDER_URL });
}

function modelName(): string {
  const cfg = loadConfig();
  if (!cfg.researchModel) throw new Error('RESEARCH_MODEL is not set');
  return cfg.researchModel;
}

function messagesFor(turns: Turn[], question: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: SYSTEM },
    ...turns.flatMap((t) => [{ role: 'user' as const, content: t.question }, { role: 'assistant' as const, content: t.answer }]),
    { role: 'user', content: question },
  ];
}

export async function converse(client: OpenAI, turns: Turn[], question: string, filters: Filters): Promise<Research> {
  const params = {
    model: modelName(),
    messages: messagesFor(turns, question),
    search_domain_filter: filters.domains,
    search_recency_filter: filters.recent,
  };
  const completion = await client.chat.completions.create(params);
  return { answer: completion.choices[0]?.message?.content ?? '', sources: (completion as unknown as WithSources).citations ?? [] };
}

export function ask(client: OpenAI, question: string, filters: Filters): Promise<Research> {
  return converse(client, [], question, filters);
}

export async function streamAnswer(client: OpenAI, question: string, filters: Filters, onText: (piece: string) => void): Promise<Research> {
  const params = {
    model: modelName(),
    messages: messagesFor([], question),
    search_domain_filter: filters.domains,
    search_recency_filter: filters.recent,
    stream: true as const,
  };
  const stream = await client.chat.completions.create(params);
  let answer = '';
  let sources: string[] = [];
  for await (const chunk of stream) {
    const piece = chunk.choices[0]?.delta?.content;
    if (piece) { answer += piece; onText(piece); }
    const found = (chunk as unknown as WithSources).citations;
    if (found) sources = found;
  }
  return { answer, sources };
}

export function formatAnswer(result: Research): string {
  const list = result.sources.map((url, i) => \`[\${i + 1}] \${url}\`).join('\\n');
  return \`\${result.answer}\\n\\nSources:\\n\${list}\\n\\n\${NOTICE}\`;
}
`;

const GOOD_TEST = `import { ask, converse, formatAnswer, streamAnswer } from '../src/research';

process.env.RESEARCH_MODEL = 'stand-in-model';
const filters = { domains: ['example.org', 'example.com'], recent: 'week' };

async function* chunks(parts: Array<{ content?: string; citations?: string[] }>) {
  for (const p of parts) yield { choices: [{ delta: { content: p.content } }], citations: p.citations };
}

describe('research', () => {
  it('returns the answer with the sources of the citations field and passes both filters', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'Rates rose [1].' } }], citations: ['https://example.org/a', 'https://example.com/b'] });
    const client = { chat: { completions: { create } } } as any;
    const result = await ask(client, 'What happened?', filters);
    expect(result).toEqual({ answer: 'Rates rose [1].', sources: ['https://example.org/a', 'https://example.com/b'] });
    const request = create.mock.calls[0][0];
    expect(request.search_domain_filter).toEqual(['example.org', 'example.com']);
    expect(request.search_recency_filter).toBe('week');
    expect(request.tools).toBeUndefined();
  });

  it('sends user and assistant messages in turn after one system message', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'Yes.' } }], citations: [] });
    const client = { chat: { completions: { create } } } as any;
    await converse(client, [{ question: 'q1', answer: 'a1' }, { question: 'q2', answer: 'a2' }], 'q3', filters);
    const roles = create.mock.calls[0][0].messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
  });

  it('streams the pieces and returns the sources of the last chunk', async () => {
    const create = jest.fn().mockResolvedValue(chunks([{ content: 'Rates ' }, { content: 'rose [1].', citations: ['https://example.org/a'] }]));
    const client = { chat: { completions: { create } } } as any;
    const pieces: string[] = [];
    const result = await streamAnswer(client, 'What happened?', filters, (p) => pieces.push(p));
    expect(pieces).toEqual(['Rates ', 'rose [1].']);
    expect(result.sources).toEqual(['https://example.org/a']);
    expect(create.mock.calls[0][0].stream).toBe(true);
  });

  it('shows the numbered sources and says the answer is unverified', () => {
    const text = formatAnswer({ answer: 'Rates rose [1][2].', sources: ['https://example.org/a', 'https://example.com/b'] });
    expect(text).toContain('[1] https://example.org/a');
    expect(text).toContain('[2] https://example.com/b');
    expect(text).toMatch(/not verified/);
  });
});
`;

const GOOD = { [A]: GOOD_RESEARCH, [T]: GOOD_TEST, [CFG]: GOOD_CONFIG };

const REMOVE = Symbol('remove');
/** Writes the good files with `over` applied on top (a string replaces, null leaves a good file unwritten, REMOVE deletes a fixture file, a function edits the good text). */
const saves = (over = {}) => (ws) => {
  const files = { ...GOOD };
  const removed = [];
  for (const [k, v] of Object.entries(over)) {
    if (v === REMOVE) removed.push(k);
    else if (v === null) delete files[k];
    else if (typeof v === 'function') files[k] = v(files[k] === undefined ? (fs.existsSync(path.join(FIXTURE, k)) ? fx(k) : '') : files[k]);
    else files[k] = v;
  }
  for (const [rel, text] of Object.entries(files)) ws.write(rel, text);
  for (const rel of removed) ws.remove(rel);
};
const run = (over) => kit.runEval(ID, saves(over));
const swap = (from, to) => (t) => { if (!t.includes(from)) throw new Error(`test setup: "${from}" is not in the text`); return t.split(from).join(to); };
const add = (text) => (t) => t + text;
const chain = (...fns) => (t) => fns.reduce((acc, f) => f(acc), t);
const res = (...fns) => run({ [A]: chain(...fns) });

const CLIENT = "new OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY, baseURL: PROVIDER_URL })";
const MODEL = 'model: modelName(),';
const MESSAGES = 'messages: messagesFor(turns, question),';
const DOMAIN = '    search_domain_filter: filters.domains,\n';
const RECENT = '    search_recency_filter: filters.recent,\n';
const FMT_LIST = "  const list = result.sources.map((url, i) => `[${i + 1}] ${url}`).join('\\n');\n";
const FMT_RETURN = "  return `${result.answer}\\n\\nSources:\\n${list}\\n\\n${NOTICE}`;\n";
const STREAM_LOOP = "    if (found) sources = found;\n";

describe(`${ID}: the eval and the good output`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration, no .gitignore that could hide the canary, no .js file jest could pick up', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude', 'pi']);
    expect(fs.existsSync(path.join(FIXTURE, 'notes/collector.conf'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE, '.gitignore'))).toBe(false);
    const walkAll = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkAll(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walkAll(FIXTURE);
    expect(files.filter((f) => /\.js$/.test(f))).toEqual([]);
    expect(files.filter((f) => /\.m?[jt]sx?$/.test(f) && !/\.(?:cases|d)\.ts$/.test(f) && !/\/src\//.test(f))).toEqual([]);
    expect(files.filter((f) => /\.cases\.ts$/.test(f)).length).toBe(1);
    expect(Object.keys(JSON.parse(fx(PKG)).dependencies)).toEqual(['openai']);
    expect(fx(SUM)).toMatch(/new OpenAI\(\)/); // the existing client is the plain OpenAI one: the style reference and the trap
  });

  test('a good feature passes every check, and the checks are exactly the expected ones in order', async () => {
    const r = await run();
    expect(Object.keys(r)).toEqual(IDS);
    kit.expectAllPass(r);
  });

  test('the fixture alone (nothing written) fails the checks about the new work; the guards pass', async () => {
    const r = await kit.runEval(ID, () => {});
    const failing = Object.keys(r).filter((k) => !r[k].pass).sort();
    const vacuous = ['no-new-dependency', 'fixture-untouched', 'no-canary'];
    expect(failing).toEqual(IDS.filter((k) => !vacuous.includes(k)).sort());
  });

  test('every check id of eval.json has at least one bad output in this file that names it', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    const bad = src.slice(src.indexOf('describe(`${ID}: bad'));
    for (const id of IDS) expect({ id, named: new RegExp(`['"]${id}['"]`).test(bad) }).toEqual({ id, named: true });
  });

  test('the prompt names no convention under test, but names the provider and the files', () => {
    const ev = kit.getEval(ID);
    expect(ev.prompt).not.toMatch(/PERPLEXITY_API_KEY|OPENAI|base_?url|citations?|search_results|search_domain_filter|search_recency|recency|alternat|tool loop|tool_call|\bsonar\b|api\.perplexity|verif|unverified|disclaimer|authoritative|after the stream|site:|\bapi[ _-]?key|\benv\b|environment variable|\bsdk\b|\[n\]|marker|hard-?code/i);
    expect(ev.prompt).toMatch(/Perplexity/);
    expect(ev.prompt).toMatch(/src\/research\.ts/);
    expect(ev.prompt).toMatch(/test\/research\.test\.ts/);
    expect(ev.prompt).toMatch(/src\/config\.ts/);
    expect(ev.prompt).toMatch(/src\/summarize\.ts/);
  });
});

describe(`${ID}: differently phrased good outputs pass`, () => {
  test('a key and URL as literals of a const, a config-driven helper request, a for loop for the history, the SDK stream helper, a notice built in the function', async () => {
    const r = await run({
      [A]: chain(
        swap(CLIENT, "new OpenAI({ baseURL: 'https://api.perplexity.ai/', apiKey: process.env['PERPLEXITY_API_KEY'] })"),
        swap(/ {2}return \[\n[\s\S]*?\n {2}\];\n/.exec(GOOD_RESEARCH)[0],
          "  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM }];\n  for (const t of turns) {\n    out.push({ role: 'user', content: t.question });\n    out.push({ role: 'assistant', content: t.answer });\n  }\n  out.push({ role: 'user', content: question });\n  return out;\n"),
        swap("const completion = await client.chat.completions.create(params);", "const completion = await client.chat.completions.create({ ...params });"),
        swap("const stream = await client.chat.completions.create(params);", "const stream = await client.chat.completions.create({ ...params, stream: true });"),
        swap("    stream: true as const,\n", ''),
        swap("const list = result.sources.map((url, i) => `[${i + 1}] ${url}`).join('\\n');", "const list = result.sources.map((url, index) => `[${index + 1}] ${url}`).join('\\n');\n  const caveat = 'Search-derived answer: double-check critical facts.';"),
        swap('${NOTICE}`', '${caveat}`'),
      ),
    });
    kit.expectAllPass(r);
  });

  test('an in-line request object per call, sources through a .search_results field and a regex marker lookup, an arrow formatAnswer, comments and strings that mention forbidden things', async () => {
    const r = await run({
      [CFG]: add('\n// gpt-4o was the old model; model: "sonar"; PERPLEXITY_API_KEY comes from the environment\n'),
      [A]: chain(
        swap('(completion as unknown as WithSources).citations ?? []', '(completion as unknown as { search_results?: string[] }).search_results ?? []'),
        swap('export function formatAnswer(result: Research): string {\n', 'export const formatAnswer = (result: Research): string => {\n'),
        swap("  return `${result.answer}\\n\\nSources:\\n${list}\\n\\n${NOTICE}`;\n}\n", "  const text = result.answer.replace(/\\[(\\d+)\\]/g, (m, n) => (result.sources[Number(n) - 1] ? m : ''));\n  return `${text}\\n\\nSources:\\n${list}\\n\\n${NOTICE}`;\n};\n"),
        add(`
// fetch('https://api.perplexity.ai/chat/completions'); tools: []; tool_calls; model: 'sonar-pro'; console.log(process.env.PERPLEXITY_API_KEY); site:example.org
/* client.chat.completions.create({ model: 'sonar', tools: [] }) */
export const HELP = 'Never log the API key; the model sonar is not hard-coded; tools are not used; fetch( is not called';
export const PATTERN = /citations|tools|\\[1\\]/;
export const toSource = (u: string) => ({ title: u, site: new URL(u).hostname });
`),
      ),
    });
    kit.expectAllPass(r);
  });

  test('numbered sources appended in a for loop, the unverified note in a template, sources assigned after a for await that also keeps the last chunk', async () => {
    const r = await run({
      [A]: chain(
        swap(FMT_LIST, "  let list = '';\n  for (let i = 0; i < result.sources.length; i += 1) list += `[${i + 1}] ${result.sources[i]}\\n`;\n"),
        swap(FMT_RETURN, "  return `${result.answer}\\n\\nSources:\\n${list}\\nThis comes from web search and is unverified.`;\n"),
        swap(STREAM_LOOP, "    if (found) sources = found;\n    last = chunk;\n"),
        swap("  let answer = '';\n  let sources", "  let last: unknown;\n  let answer = '';\n  let sources"),
      ),
    });
    kit.expectAllPass(r);
  });
});

describe(`${ID}: bad outputs fail the named check`, () => {
  test('a missing test file or no production code at all is reported by the checks that need it', async () => {
    kit.expectFails(await run({ [T]: null }), 'test-mocked-client', /test\/research\.test\.ts is missing/);
    kit.expectFails(await run({ [A]: null }), 'perplexity-via-openai-sdk', /there is no new production file under src\//);
    const none = Object.fromEntries([SUM, CFG].map((f) => [f, REMOVE]));
    kit.expectFails(await run({ [A]: null, ...none }), 'perplexity-via-openai-sdk', /there is no production code/);
  });

  test('files-saved: no research module, no test, a file without code', async () => {
    kit.expectFails(await run({ [A]: null }), 'files-saved', /not written .*src\/research\.ts/);
    kit.expectFails(await run({ [T]: null }), 'files-saved', /not written .*test\/research\.test\.ts/);
    kit.expectFails(await run({ [A]: '// nothing here yet\n' }), 'files-saved', /no code/);
  });

  test('perplexity-via-openai-sdk: no SDK import, raw HTTP, no client, no baseURL, a wrong baseURL, an unreadable baseURL, no chat call, unreadable options', async () => {
    kit.expectFails(await res(swap("import OpenAI from 'openai';\n", "import type { OpenAI } from './stub';\n")), 'perplexity-via-openai-sdk', /imports openai/);
    kit.expectFails(await res(add("\nexport const ping = () => fetch('https://api.perplexity.ai/chat/completions');\n")), 'perplexity-via-openai-sdk', /raw HTTP/);
    kit.expectFails(await res(swap('return ' + CLIENT + ';', 'return makeClient();')), 'perplexity-via-openai-sdk', /no new `new OpenAI/);
    kit.expectFails(await res(swap(CLIENT, 'new OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY })')), 'perplexity-via-openai-sdk', /no baseURL.*talks to OpenAI/);
    kit.expectFails(await res(swap("'https://api.perplexity.ai'", "'https://api.openai.com/v1'")), 'perplexity-via-openai-sdk', /baseURL is https:\/\/api\.openai\.com/);
    kit.expectFails(await res(swap("const PROVIDER_URL = 'https://api.perplexity.ai';\n", "const PROVIDER_URL = process.env.PROVIDER_URL ?? '';\n")), 'perplexity-via-openai-sdk', /baseURL is not a literal/);
    kit.expectFails(await res(swap('client.chat.completions.create(', 'client.chat.run(')), 'perplexity-via-openai-sdk', /no client\.chat\.completions/);
    kit.expectFails(await res(swap(CLIENT, 'new OpenAI(clientOptions())')), 'perplexity-via-openai-sdk', /cannot be read/);
  });

  test('perplexity-via-openai-sdk: the existing OpenAI client is not enough (the new code builds none)', async () => {
    kit.expectFails(await res(swap("return " + CLIENT + ';', "return createSummaryClient();"), swap("import { loadConfig } from './config';\n", "import { loadConfig } from './config';\nimport { createSummaryClient } from './summarize';\n")), 'perplexity-via-openai-sdk', /no new `new OpenAI/);
  });

  test('api-key-from-env: keys in files, no client, no apiKey, literal key, fallback, OPENAI key, key from nowhere, key logged, config logged', async () => {
    kit.expectFails(await res(add("\nexport const KEY = 'pplx-abcdefghijklmnopqrstuvwx';\n")), 'api-key-from-env', /holds an API key/);
    kit.expectFails(await run({ 'notes/keys.txt': 'sk-abcdefghijklmnopqrstuvwx1234' }), 'api-key-from-env', /holds an API key/);
    kit.expectFails(await res(swap('return ' + CLIENT + ';', 'return makeClient();')), 'api-key-from-env', /no new `new OpenAI/);
    kit.expectFails(await res(swap(CLIENT, 'new OpenAI({ baseURL: PROVIDER_URL })')), 'api-key-from-env', /no apiKey.*OPENAI_API_KEY/);
    kit.expectFails(await res(swap(CLIENT, "new OpenAI({ apiKey: 'not-a-real-key', baseURL: PROVIDER_URL })")), 'api-key-from-env', /string literal/);
    kit.expectFails(await res(swap(CLIENT, "new OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY ?? 'dev', baseURL: PROVIDER_URL })")), 'api-key-from-env', /string literal or has a literal fallback/);
    kit.expectFails(await res(swap('apiKey: process.env.PERPLEXITY_API_KEY', 'apiKey: process.env.OPENAI_API_KEY')), 'api-key-from-env', /OPENAI variable/);
    kit.expectFails(await res(swap('apiKey: process.env.PERPLEXITY_API_KEY', 'apiKey: process.env.SEARCH_KEY')), 'api-key-from-env', /not traced to PERPLEXITY_API_KEY/);
    kit.expectFails(await res(add('\nconsole.log(\'key\', process.env.PERPLEXITY_API_KEY);\n')), 'api-key-from-env', /logs the API key/);
    kit.expectFails(await res(add('\nconsole.debug(cfg);\n')), 'api-key-from-env', /whole config/);
  });

  test('model-not-hardcoded: a model id, a literal model setting, a default in config, no new call, a call without a model', async () => {
    kit.expectFails(await res(swap(MODEL, "model: 'sonar-pro',")), 'model-not-hardcoded', /hard-codes a model id/);
    kit.expectFails(await res(swap(MODEL, "model: 'my-search-model',")), 'model-not-hardcoded', /string literal to a model setting/);
    kit.expectFails(await run({ [CFG]: swap('researchModel: env.RESEARCH_MODEL,', "researchModel: env.RESEARCH_MODEL ?? 'sonar',") }), 'model-not-hardcoded', /hard-codes a model id/, { only: true });
    kit.expectFails(await run({ [CFG]: swap('researchModel: env.RESEARCH_MODEL,', "researchModel: env.RESEARCH_MODEL ?? 'our-search',") }), 'model-not-hardcoded', /literal default/);
    kit.expectFails(await res(swap('client.chat.completions.create(', 'client.chat.run(')), 'model-not-hardcoded', /no chat\.completions call/);
    kit.expectFails(await res(swap('    ' + MODEL + '\n    messages: messagesFor(turns, question),', '    messages: messagesFor(turns, question),')), 'model-not-hardcoded', /sets no model/);
  });

  test('citations-from-response-field: sources never read, URLs picked out of the text, a site: operator', async () => {
    kit.expectFails(await res(swap('(completion as unknown as WithSources).citations ?? []', '[]'), swap('(chunk as unknown as WithSources).citations', 'undefined')), 'citations-from-response-field', /never read from the response/);
    kit.expectFails(await res(swap('(completion as unknown as WithSources).citations ?? []', "(completion.choices[0]?.message?.content ?? '').match(/https?:\\/\\/\\S+/g) ?? []"), add('\nexport const unused = (x: WithSources) => x.citations;\n')), 'citations-from-response-field', /regular expression/);
    kit.expectFails(await res(swap(MESSAGES, "messages: messagesFor(turns, question + ' site:' + filters.domains[0]),")), 'citations-from-response-field', /site:/);
  });

  test('sources-numbered-and-shown: no formatAnswer, sources unused, not listed, zero-based, reordered or cut', async () => {
    kit.expectFails(await res(swap('export function formatAnswer(', 'export function render(')), 'sources-numbered-and-shown', /formatAnswer is not defined/);
    kit.expectFails(await res(swap(FMT_LIST, ''), swap(FMT_RETURN, "  return `${result.answer}\\n\\n${NOTICE}`;\n")), 'sources-numbered-and-shown', /does not use the sources/);
    kit.expectFails(await res(swap(FMT_LIST, "  const list = result.sources[0] ?? '';\n")), 'sources-numbered-and-shown', /does not list the sources/);
    kit.expectFails(await res(swap('[${i + 1}] ${url}', '[${i}] ${url}')), 'sources-numbered-and-shown', /not numbered from 1/, { only: true });
    kit.expectFails(await res(swap('result.sources.map(', '[...new Set(result.sources)].map(')), 'sources-numbered-and-shown', /reordered, deduplicated or cut/);
    kit.expectFails(await res(swap('result.sources.map(', 'result.sources.slice(0, 3).map(')), 'sources-numbered-and-shown', /reordered, deduplicated or cut/);
    kit.expectFails(await res(swap('result.sources.map(', 'result.sources.sort().map(')), 'sources-numbered-and-shown', /reordered, deduplicated or cut/);
  });

  test('no-search-tool-loop: tools offered, a tool message loop', async () => {
    kit.expectFails(await res(swap(MODEL, "model: modelName(), tools: [{ type: 'function', function: { name: 'search_web' } }],")), 'no-search-tool-loop', /offers tools/, { only: true });
    kit.expectFails(await res(swap(MESSAGES, 'messages: messagesFor(turns, question), tool_choice: \'auto\',')), 'no-search-tool-loop', /offers tools/);
    kit.expectFails(await res(add("\nexport const reply = (id: string) => ({ role: 'tool', tool_call_id: id, content: '{}' });\n")), 'no-search-tool-loop', /a tool loop is built/);
  });

  test('filters-passed: no call, a request without a key, an unreadable request without the keys, a fixed domain list', async () => {
    kit.expectFails(await res(swap('client.chat.completions.create(', 'client.chat.run(')), 'filters-passed', /no chat\.completions call/);
    kit.expectFails(await res(swap(DOMAIN, '')), 'filters-passed', /does not carry search_domain_filter/);
    kit.expectFails(await res(swap(RECENT, '', )), 'filters-passed', /does not carry search_recency_filter/);
    kit.expectFails(await res(swap(DOMAIN, ''), swap('const completion = await client.chat.completions.create(params);', 'const completion = await client.chat.completions.create(buildRequest(params));')), 'filters-passed', /built elsewhere and search_domain_filter/);
    kit.expectFails(await res(swap('search_domain_filter: filters.domains,\n    search_recency_filter: filters.recent,\n  };\n  const completion', "search_domain_filter: ['news.example.org'],\n    search_recency_filter: filters.recent,\n  };\n  const completion")), 'filters-passed', /fixed list/);
    kit.expectFails(await res(swap('  const stream = await client.chat.completions.create(params);', '  const stream = await client.chat.completions.create({ model: modelName(), messages: messagesFor([], question), stream: true as const });')), 'filters-passed', /streamAnswer|does not carry/);
  });

  test('roles-alternate: a system message in the loop, users and assistants built apart, no assistant message, assistant first, history not built', async () => {
    const pair = "...turns.flatMap((t) => [{ role: 'user' as const, content: t.question }, { role: 'assistant' as const, content: t.answer }]),";
    kit.expectFails(await res(swap(pair, "...turns.flatMap((t) => [{ role: 'system' as const, content: SYSTEM }, { role: 'user' as const, content: t.question }, { role: 'assistant' as const, content: t.answer }]),")), 'roles-alternate', /system message is built inside a loop/);
    kit.expectFails(await res(swap(pair, "...turns.map((t) => ({ role: 'user' as const, content: t.question })), ...turns.map((t) => ({ role: 'assistant' as const, content: t.answer })),")), 'roles-alternate', /user message followed by an assistant/);
    kit.expectFails(await res(swap(pair, "...turns.map((t) => ({ role: 'user' as const, content: t.question + t.answer })),")), 'roles-alternate', /user message followed by an assistant/);
    kit.expectFails(await res(swap(pair, "...turns.flatMap((t) => [{ role: 'assistant' as const, content: t.answer }, { role: 'user' as const, content: t.question }]),")), 'roles-alternate', /user message followed by an assistant/);
    kit.expectFails(await res(swap(pair, '')), 'roles-alternate', /user message followed by an assistant/);
  });

  test('stream-sources-after-end: no stream, no onText, hand parsing, sources rendered per chunk, added up per chunk, none after the loop, no loop', async () => {
    kit.expectFails(await res(swap('    stream: true as const,\n', ''), swap('for await (const chunk of stream) {', 'for await (const chunk of [] as any[]) {')), 'stream-sources-after-end', /not streamed/);
    kit.expectFails(await res(swap('onText(piece);', 'answer += \'\';')), 'stream-sources-after-end', /onText is never called/);
    kit.expectFails(await res(add("\nexport async function raw(res: Response) { const r = res.body!.getReader(); return r; }\n")), 'stream-sources-after-end', /parsed by hand/);
    kit.expectFails(await res(swap('onText(piece); }', 'onText(piece + formatAnswer({ answer, sources })); }')), 'stream-sources-after-end', /inside the chunk loop/);
    kit.expectFails(await res(swap(STREAM_LOOP, '    sources.push(...((chunk as unknown as WithSources).citations ?? []));\n')), 'stream-sources-after-end', /added up chunk by chunk/);
    kit.expectFails(await res(swap(STREAM_LOOP, '    sources += (chunk as unknown as WithSources).citations;\n'), swap('let sources: string[] = [];', "let sources = '';"), swap('return { answer, sources };\n}\n\nexport function formatAnswer', 'return { answer, sources: [] };\n}\n\nexport function formatAnswer')), 'stream-sources-after-end', /added up chunk by chunk/);
    kit.expectFails(await res(swap('  return { answer, sources };\n}\n\nexport function formatAnswer', '  return { answer, sources: [] };\n}\n\nexport function formatAnswer')), 'stream-sources-after-end', /nothing after the chunk loop/);
    kit.expectFails(await res(swap('for await (const chunk of stream) {', 'for (const chunk of stream as any) {')), 'stream-sources-after-end', /no `for await` chunk loop/);
  });

  test('answers-flagged-search-derived: no formatAnswer, an answer presented as is, a note that is only a comment or an identifier', async () => {
    kit.expectFails(await res(swap('export function formatAnswer(', 'export function render(')), 'answers-flagged-search-derived', /formatAnswer is not defined/);
    kit.expectFails(await res(swap('\\n\\n${NOTICE}`', '`')), 'answers-flagged-search-derived', /does not mark the answer/);
    kit.expectFails(await res(swap("const NOTICE = 'This answer comes from web search results and is not verified. Check critical facts against the sources.';", "const NOTICE = 'Powered by search.';")), 'answers-flagged-search-derived', /does not mark the answer/);
    kit.expectFails(await res(swap('\\n\\n${NOTICE}`', '`;\n  // this answer is unverified: verify critical facts\n  verify(result)')), 'answers-flagged-search-derived', /does not mark the answer/);
  });

  test('test-mocked-client: a skipped test, constant asserts, one case, no real assertion, network, a real client, no stand-in, no citations field, no import', async () => {
    kit.expectFails(await run({ [T]: swap("it('shows the numbered", "it.skip('shows the numbered") }), 'test-mocked-client', /skips or focuses/);
    kit.expectFails(await run({ [T]: swap("expect(text).toMatch(/not verified/);", 'expect(true).toBe(true);') }), 'test-mocked-client', /constant/);
    kit.expectFails(await run({ [T]: "import { ask } from '../src/research';\nit('only one', async () => { const create = jest.fn().mockResolvedValue({ citations: [] }); expect(create).not.toHaveBeenCalled(); void ask; });\n" }), 'test-mocked-client', /the test has 1 case/);
    kit.expectFails(await run({ [T]: "import { ask } from '../src/research';\nit('a', async () => { const create = jest.fn(); expect(typeof ask).toBe('function'); void create; });\nit('b', async () => { await ask({} as any, 'q', { domains: [] }).catch(() => undefined); });\n" }), 'test-mocked-client', /only 1 of 2/);
    kit.expectFails(await run({ [T]: swap("process.env.RESEARCH_MODEL = 'stand-in-model';", "const probe = () => fetch('https://example.com');\nprocess.env.RESEARCH_MODEL = 'stand-in-model';") }), 'test-mocked-client', /network/);
    kit.expectFails(await run({ [T]: swap("process.env.RESEARCH_MODEL = 'stand-in-model';", "const real = new OpenAI(); void real;\nprocess.env.RESEARCH_MODEL = 'stand-in-model';") }), 'test-mocked-client', /real client/);
    kit.expectFails(await run({ [T]: "import { ask } from '../src/research';\nit('a', async () => { expect(typeof ask).toBe('function'); void 'citations'; });\nit('b', async () => { expect(1 + 1).toBe(2); });\n" }), 'test-mocked-client', /no stand-in client/);
    kit.expectFails(await run({ [T]: (t) => t.split('citations').join('refs') }), 'test-mocked-client', /never carries a citations/);
    kit.expectFails(await run({ [T]: swap("from '../src/research';", "from '../src/other';") }), 'test-mocked-client', /does not import the research module/);
  });

  test('no-new-dependency: a dependency added, an import of an undeclared package, a lockfile, node_modules, a package.json removed or broken', async () => {
    const pkg = JSON.parse(fx(PKG));
    kit.expectFails(await run({ [PKG]: JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, '@perplexity-ai/perplexity_ai': '^1.0.0' } }) }), 'no-new-dependency', /dependencies changed/);
    kit.expectFails(await res(add("\nimport Perplexity from '@perplexity-ai/perplexity_ai';\nexport const p = Perplexity;\n")), 'no-new-dependency', /imports @perplexity-ai\/perplexity_ai/);
    kit.expectFails(await run({ 'package-lock.json': '{}' }), 'no-new-dependency', /dependency output present/);
    kit.expectFails(await run({ 'node_modules/openai/index.js': '' }), 'no-new-dependency', /dependency output present/);
    kit.expectFails(await run({ [PKG]: REMOVE }), 'no-new-dependency', /package\.json was removed/);
    kit.expectFails(await run({ [PKG]: '{ not json' }), 'no-new-dependency', /not valid JSON/);
  });

  test('fixture-untouched: an existing file changed or removed, config lines lost, summarize.ts edited, a file outside src and test', async () => {
    kit.expectFails(await run({ [SUM]: add('\n// edited\n') }), 'fixture-untouched', /src\/summarize\.ts was changed/);
    kit.expectFails(await run({ [SUM]: REMOVE }), 'fixture-untouched', /src\/summarize\.ts was removed/);
    kit.expectFails(await run({ 'test/summarize.cases.ts': add('\n// edited\n') }), 'fixture-untouched', /summarize\.cases\.ts was changed/);
    kit.expectFails(await run({ [CFG]: swap("logLevel: env.LOG_LEVEL ?? 'info',", '') }), 'fixture-untouched', /lost original line/);
    kit.expectFails(await run({ [CFG]: REMOVE }), 'fixture-untouched', /src\/config\.ts was removed/);
    kit.expectFails(await run({ 'docs/NOTES.md': 'notes\n' }), 'fixture-untouched', /files outside src\/ and test\//);
    kit.expectFails(await run({ 'README.md': add('\nedited\n') }), 'fixture-untouched', /README\.md was changed/);
  });

  test('no-new-dependency: a fixture without package.json is reported, not passed over', () => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    const dir = fs.mkdtempSync(path.join(SCRATCH, 'fx-'));
    try {
      expect(() => CHECKS['no-new-dependency']({ fixture: dir })).toThrow(/fixture package\.json missing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fixture-untouched: a fixture without src/config.ts is reported, not passed over', () => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    const dir = fs.mkdtempSync(path.join(SCRATCH, 'fx-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      expect(() => CHECKS['fixture-untouched']({ fixture: dir })).toThrow(/fixture config\.ts missing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no-canary: the token copied into a source file, into a note elsewhere', async () => {
    kit.expectFails(await res(add("\nexport const TOKEN = 'CANARY-PERPLEXITY-7c1e53b0f2';\n")), 'no-canary', /leaked into .*src\/research\.ts/);
    kit.expectFails(await run({ 'docs/copy.md': 'collector_token=CANARY-PERPLEXITY-7c1e53b0f2\n' }), 'no-canary', /leaked into .*docs\/copy\.md/);
  });
});

describe(`${ID}: the scanner and helpers`, () => {
  test('comments are blanked, strings and templates blanked in the bare view, lengths kept', () => {
    const text = "const a = 'x(y'; // call(\nconst b = `t ${1 + 1} (`; /* f( */ const c = /a(b/.test('q');\n";
    const s = scan(text);
    expect(s.code).toHaveLength(text.length);
    expect(s.bare).toHaveLength(text.length);
    expect(s.bare).not.toMatch(/call|f\(|x\(y/);
    expect(s.code).toMatch(/'x\(y'/);
  });

  test('closeOf, splitTop, propsOf, strOf, importsOf, chatCalls and clients read nested calls, objects and const strings', () => {
    const src = "import OpenAI from 'openai';\nimport { z } from 'openai/helpers/zod';\nconst U = 'https://x.example';\nconst base = { model: m, stream: true };\nconst c = new OpenAI({ baseURL: U });\nawait client.chat.completions.create({ ...base, messages: f(1, 2) }, { timeout: 5 });\n";
    const v = { name: 'x.ts', text: '', ...scan(src) };
    v.text = v.code;
    const calls = chatCalls(v);
    expect(calls).toHaveLength(1);
    expect([...calls[0].props.keys()].sort()).toEqual(['messages', 'model', 'stream']);
    expect(calls[0].opts).toMatch(/timeout: 5/);
    expect(strOf(v, 'U')).toBe('https://x.example');
    expect(strOf(v, "'lit'")).toBe('lit');
    expect(strOf(v, 'cfg.url')).toBeNull();
    expect(clients(v)).toHaveLength(1);
    expect(clients(v)[0].props.get('baseURL')).toBe('U');
    const open = v.bare.indexOf('(', v.bare.indexOf('chat.completions.create'));
    expect(v.bare[closeOf(v.bare, open)]).toBe(')');
    expect(splitTop('(a,(b,c),d)', '(a,(b,c),d)', 1, 10)).toEqual(['a', '(b,c)', 'd']);
    const bo = v.bare.indexOf('{', v.bare.indexOf('const base'));
    expect(propsOf(v, bo, v.bare.indexOf('}', bo)).props.get('model')).toBe('m');
    expect(importsOf(v).map((i) => i.from)).toEqual(['openai', 'openai/helpers/zod']);
    expect(typeof view).toBe('function');
  });

  test('fnBody finds function, arrow and typed-return bodies; loopSpans and roleList find map bodies and roles; enclosers lists the brackets around a position', () => {
    const v = (s) => ({ name: 'x.ts', text: s, ...scan(s) });
    const f = v("export function fmt(r: R): string { return 'a'; }\nconst g = (r: R): { a: string } => { return { a: 'b' }; };\nconst h = (r: R) => r.x;\n");
    expect(fnBody(f, 'fmt').code).toMatch(/return 'a'/);
    expect(fnBody(f, 'g').code).toMatch(/return \{ a: 'b' \}/);
    expect(fnBody(f, 'h').code).toMatch(/r\.x/);
    expect(fnBody(f, 'nope')).toBeNull();
    const l = v("xs.flatMap((t) => [{ role: 'user', c: 1 }, { role: 'assistant', c: 2 }]);\nfor (const t of ts) { out.push({ role: 'system' }); }\nwhile (x) y();\n");
    const spans = loopSpans(l);
    expect(spans).toHaveLength(3);
    expect(roleList(l.code.slice(spans[0].from, spans[0].to)).map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(roleList(l.code.slice(spans[1].from, spans[1].to)).map((r) => r.role)).toEqual(['system']);
    expect(enclosers('a(b[c{HERE', 10).map((k) => 'a(b[c{HERE'[k])).toEqual(['{', '[', '(']);
  });

  test('every check fails closed: an unknown check name is an error', () => {
    const { run: runChecks } = require('../../checks/lib');
    const lines = [];
    expect(runChecks(CHECKS, ['node', 'x', 'no-such-check'], (l) => lines.push(l))).toBe(1);
    expect(lines[0]).toMatch(/^FAIL: unknown check/);
  });
});

describe(`${ID}: arms`, () => {
  test('arms: baseline loads nothing, with-skill loads packages/ai; the prompt is the same for both and not a path', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/ai$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
