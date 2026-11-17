'use strict';

/**
 * Kit tests for the `openai` skill eval: a good output passes every check, differently phrased good outputs do too, and bad outputs
 * each fail the named check (with the reason that check gives). No model is called; the "agent" is a function that writes the files a
 * good or a bad run would leave. The TypeScript below is never compiled or run; it is only text for the static checks.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');
const { CHECKS, scan, closeOf, splitTop, apiCalls, clients, propsOf, numOf, importsOf, view, enclosers, inLoop, inTry } = require('../../checks/openai');

jest.setTimeout(240000); // each run spawns one node process per check

const ID = 'openai';
const IDS = [
  'files-saved', 'uses-sdk', 'model-not-hardcoded', 'no-hardcoded-limits-prices', 'api-key-from-env', 'key-not-logged', 'chat-completions-kept',
  'tool-uses-existing-lookup', 'tool-message-every-id', 'tool-args-validated', 'tool-failure-reported', 'structured-output-schema',
  'embeddings-one-model', 'embeddings-batched', 'streaming-accumulates-by-index', 'rate-limit-handled', 'timeout-set', 'test-mocked-client',
  'no-new-dependency', 'fixture-untouched', 'no-canary',
];
const FIXTURE = path.resolve(__dirname, '../../skills/openai/fixture');
const fx = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const A = 'src/assistant.ts';
const T = 'test/assistant.test.ts';
const CFG = 'src/config.ts';
const BOT = 'src/bot.ts';
const PKG = 'package.json';

const GOOD_CONFIG = fx(CFG)
  .replace('  model: string | undefined;\n', '  model: string | undefined;\n  embeddingModel: string | undefined;\n')
  .replace('    model: env.BOT_MODEL,\n', '    model: env.BOT_MODEL,\n    embeddingModel: env.BOT_EMBEDDING_MODEL,\n');

const GOOD_ASSISTANT = `import OpenAI from 'openai';
import { loadConfig } from './config';
import type { FaqEntry } from './faq';
import { lookupOrderStatus } from './orders';
import type { Ticket } from './tickets';

const MAX_TURNS = 6;

/** The SDK reads OPENAI_API_KEY from the environment; it backs off on 429 and honours Retry-After. */
export function createClient(): OpenAI {
  return new OpenAI({ maxRetries: 4, timeout: 30_000 });
}

function settings() {
  const cfg = loadConfig();
  if (!cfg.model) throw new Error('BOT_MODEL is not set');
  if (!cfg.embeddingModel) throw new Error('BOT_EMBEDDING_MODEL is not set');
  return { ...cfg, model: cfg.model, embeddingModel: cfg.embeddingModel };
}

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_order_status',
      description: 'Look up the status of one order by its id.',
      parameters: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'], additionalProperties: false },
    },
  },
];

interface Acc { id: string; name: string; arguments: string }

function runTool(call: Acc): OpenAI.Chat.ChatCompletionToolMessageParam {
  try {
    const args = JSON.parse(call.arguments) as { order_id?: unknown };
    if (typeof args.order_id !== 'string') throw new Error('order_id must be a string');
    const status = lookupOrderStatus(args.order_id);
    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(status ?? { error: 'no such order' }) };
  } catch (err) {
    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: (err as Error).message }) };
  }
}

export async function answerWithOrders(client: OpenAI, question: string, onText: (piece: string) => void): Promise<string> {
  const cfg = settings();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You answer questions for the customers of a web shop. Keep it short and polite.' },
    { role: 'user', content: question },
  ];
  let reply = '';
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const stream = await client.chat.completions.create({ model: cfg.model, messages, tools: TOOLS, stream: true });
    const calls = new Map<number, Acc>();
    let text = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) { text += delta.content; onText(delta.content); }
      for (const part of delta.tool_calls ?? []) {
        const acc = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
        if (part.id) acc.id = part.id;
        if (part.function?.name) acc.name += part.function.name;
        acc.arguments += part.function?.arguments ?? '';
        calls.set(part.index, acc);
      }
    }
    reply += text;
    if (calls.size === 0) return reply;
    const ordered = [...calls.values()];
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: ordered.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })),
    });
    for (const call of ordered) messages.push(runTool(call));
  }
  throw new Error('too many tool turns');
}

export interface Triage { category: 'billing' | 'shipping' | 'product' | 'other'; priority: 'low' | 'normal' | 'high'; needsHuman: boolean }

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['billing', 'shipping', 'product', 'other'] },
    priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    needsHuman: { type: 'boolean' },
  },
  required: ['category', 'priority', 'needsHuman'],
  additionalProperties: false,
};

export async function triageTicket(client: OpenAI, ticket: Ticket): Promise<Triage> {
  const cfg = settings();
  const completion = await client.chat.completions.create({
    model: cfg.model,
    messages: [
      { role: 'system', content: 'Triage the support ticket.' },
      { role: 'user', content: ticket.subject + ' ' + ticket.body },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'triage', strict: true, schema: TRIAGE_SCHEMA } },
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('the model returned no triage');
  return JSON.parse(content) as Triage;
}

export interface PreparedFaq { entries: FaqEntry[]; vectors: number[][] }

async function embed(client: OpenAI, inputs: string[]): Promise<number[][]> {
  const cfg = settings();
  const res = await client.embeddings.create({ model: cfg.embeddingModel, input: inputs });
  return res.data.map((d) => d.embedding);
}

export async function prepareFaq(client: OpenAI, entries: FaqEntry[]): Promise<PreparedFaq> {
  return { entries, vectors: await embed(client, entries.map((e) => e.question)) };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function findFaq(client: OpenAI, prepared: PreparedFaq, query: string): Promise<FaqEntry> {
  const [q] = await embed(client, [query]);
  let best = 0;
  prepared.vectors.forEach((v, i) => { if (cosine(q, v) > cosine(q, prepared.vectors[best])) best = i; });
  return prepared.entries[best];
}
`;

const GOOD_TEST = `import { answerWithOrders, findFaq, prepareFaq, triageTicket } from '../src/assistant';
import { FAQ } from '../src/faq';

process.env.BOT_MODEL = 'stand-in-model';
process.env.BOT_EMBEDDING_MODEL = 'stand-in-embedding';

async function* chunks(parts: unknown[]) {
  for (const delta of parts) yield { choices: [{ delta }] };
}

describe('assistant', () => {
  it('streams the reply and answers every tool call with its own id', async () => {
    const first = chunks([
      { tool_calls: [{ index: 0, id: 'c1', function: { name: 'lookup_order_status', arguments: '{"order_' } }] },
      { tool_calls: [{ index: 0, function: { arguments: 'id":"ORD-1001"}' } }, { index: 1, id: 'c2', function: { name: 'lookup_order_status', arguments: '{"order_id":"bad"}' } }] },
    ]);
    const second = chunks([{ content: 'Your order ' }, { content: 'shipped.' }]);
    const create = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const client = { chat: { completions: { create } } } as any;
    const pieces: string[] = [];
    const reply = await answerWithOrders(client, 'Where is ORD-1001?', (p) => pieces.push(p));
    const sent = create.mock.calls[1][0].messages;
    const tools = sent.filter((m: { role: string }) => m.role === 'tool');
    expect(tools.map((m: { tool_call_id: string }) => m.tool_call_id)).toEqual(['c1', 'c2']);
    expect(JSON.parse(tools[0].content).status).toBe('shipped');
    expect(JSON.parse(tools[1].content).error).toMatch(/malformed/);
    expect(reply).toBe('Your order shipped.');
    expect(pieces).toEqual(['Your order ', 'shipped.']);
  });

  it('triages a ticket through a strict schema', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"category":"billing","priority":"high","needsHuman":true}' } }] });
    const client = { chat: { completions: { create } } } as any;
    const t = await triageTicket(client, { id: '1', customer: 'Ada', subject: 'Charged twice', body: 'Please fix.' });
    expect(t).toEqual({ category: 'billing', priority: 'high', needsHuman: true });
    expect(create.mock.calls[0][0].response_format.json_schema.strict).toBe(true);
  });

  it('embeds the FAQ in one call and the query with the same model, and returns the closest entry', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce({ data: FAQ.map((_e, i) => ({ embedding: i === 1 ? [0, 1] : [1, 0] })) })
      .mockResolvedValueOnce({ data: [{ embedding: [0, 1] }] });
    const client = { embeddings: { create } } as any;
    const prepared = await prepareFaq(client, FAQ);
    const hit = await findFaq(client, prepared, 'when do I get my money back');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].input).toHaveLength(FAQ.length);
    expect(create.mock.calls[1][0].model).toBe(create.mock.calls[0][0].model);
    expect(hit.id).toBe(FAQ[1].id);
  });
});
`;

const GOOD = { [A]: GOOD_ASSISTANT, [T]: GOOD_TEST, [CFG]: GOOD_CONFIG };

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
const asst = (...fns) => run({ [A]: chain(...fns) });

const CLIENT_GOOD = 'new OpenAI({ maxRetries: 4, timeout: 30_000 })';
const STREAM_CALL = 'const stream = await client.chat.completions.create({ model: cfg.model, messages, tools: TOOLS, stream: true });';

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
    const pkg = JSON.parse(fx(PKG));
    expect(Object.keys(pkg.dependencies)).toContain('openai');
    expect(fx(BOT)).toMatch(/chat\.completions\.create/); // the existing flow is Chat Completions
  });

  test('a good feature passes every check, and the checks are exactly the expected ones in order', async () => {
    const res = await run();
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('the fixture alone (nothing written) fails the checks about the new work; what the existing bot.ts already satisfies and the guards pass', async () => {
    const res = await kit.runEval(ID, () => {});
    const failing = Object.keys(res).filter((k) => !res[k].pass).sort();
    const vacuous = ['model-not-hardcoded', 'no-hardcoded-limits-prices', 'api-key-from-env', 'key-not-logged', 'chat-completions-kept', 'no-new-dependency', 'fixture-untouched', 'no-canary'];
    expect(failing).toEqual(IDS.filter((k) => !vacuous.includes(k)).sort());
  });

  test('every check id of eval.json has at least one bad output in this file that names it', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    const bad = src.slice(src.indexOf('describe(`${ID}: bad'));
    for (const id of IDS) expect({ id, named: new RegExp(`['"]${id}['"]`).test(bad) }).toEqual({ id, named: true });
  });

  test('the prompt names no convention under test', () => {
    const ev = kit.getEval(ID);
    expect(ev.prompt).not.toMatch(/OPENAI_API_KEY|\bresponses?\b|\bstrict\b|json_schema|retry|retries|retry-after|backoff|tool message|\bindex|deltas?\b|timeout|time out|timed out|rate.?limit|\b429\b|api[ _-]?key|\benv\b|environment variable|zod|chat completions|max_tokens|batch|tool_call|\bsdk\b|accumulat/i);
    expect(ev.prompt).toMatch(/src\/assistant\.ts/);
    expect(ev.prompt).toMatch(/test\/assistant\.test\.ts/);
    expect(ev.prompt).toMatch(/src\/bot\.ts/);
    expect(ev.prompt).toMatch(/src\/config\.ts/);
  });
});

describe(`${ID}: differently phrased good outputs pass`, () => {
  test('the SDK stream helper with finalChatCompletion, a key read from the environment, a per-request timeout, the zod response format and a parse call', async () => {
    const res = await run({
      [A]: chain(
        swap(CLIENT_GOOD, 'new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 20_000 })'),
        swap(STREAM_CALL, "const stream = client.chat.completions.stream({ model: cfg.model, messages, tools: TOOLS }, { timeout: 20_000 });\n    stream.on('content', (piece) => { onText(piece); });\n    const final = await stream.finalChatCompletion();"),
        swap(/for await \(const chunk of stream\) \{[\s\S]*?\n {4}\}\n {4}reply \+= text;\n {4}if \(calls\.size === 0\) return reply;\n {4}const ordered = \[\.\.\.calls\.values\(\)\];/.exec(GOOD_ASSISTANT)[0],
          "const msg = final.choices[0].message;\n    const text = msg.content ?? '';\n    reply += text;\n    if (!msg.tool_calls?.length) return reply;\n    const ordered = msg.tool_calls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));"),
        swap("    const calls = new Map<number, Acc>();\n    let text = '';\n", ''),
        swap("response_format: { type: 'json_schema', json_schema: { name: 'triage', strict: true, schema: TRIAGE_SCHEMA } },", "response_format: zodResponseFormat(TriageZ, 'triage'),"),
        swap("import OpenAI from 'openai';\n", "import OpenAI from 'openai';\nimport { zodResponseFormat } from 'openai/helpers/zod';\nimport { z } from 'zod';\n"),
        swap('const TRIAGE_SCHEMA = {', "const TriageZ = z.object({ category: z.enum(['billing', 'shipping', 'product', 'other']), priority: z.enum(['low', 'normal', 'high']), needsHuman: z.boolean() });\nconst UNUSED_SCHEMA = {"),
      ),
    });
    kit.expectAllPass(res);
  });

  test('tool messages built by .map inside Promise.all, a hand-written backoff that reads Retry-After, a timeout per request, embeddings called with an array literal', async () => {
    const res = await run({
      [A]: chain(
        swap(CLIENT_GOOD, 'new OpenAI({ maxRetries: 0 })'),
        swap('const stream = await client.chat.completions.create({ model: cfg.model, messages, tools: TOOLS, stream: true });', 'const stream = await withBackoff(() => client.chat.completions.create({ model: cfg.model, messages, tools: TOOLS, stream: true }, { timeout: 20_000 }));'),
        swap('    for (const call of ordered) messages.push(runTool(call));\n', '    messages.push(...(await Promise.all(ordered.map(async (call) => runTool(call)))));\n'),
        swap("const res = await client.embeddings.create({ model: cfg.embeddingModel, input: inputs });", "const res = await client.embeddings.create({ model: cfg.embeddingModel, input: [...inputs] }, { timeout: 20_000 });"),
        swap("strict: true, schema: TRIAGE_SCHEMA } },\n  });", "strict: true, schema: TRIAGE_SCHEMA } },\n  }, { timeout: 20_000 });"),
        add(`
async function withBackoff<T>(call: () => Promise<T>): Promise<T> {
  let delay = 500;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { return await call(); } catch (err) {
      const e = err as { status?: number; headers?: Record<string, string> };
      if (e.status !== 429) throw err;
      const wait = Number(e.headers?.['retry-after']) * 1000 || delay;
      await new Promise((r) => setTimeout(r, wait));
      delay *= 2;
    }
  }
  throw new Error('rate limited');
}
`),
      ),
    });
    kit.expectAllPass(res);
  });

  test('a client timeout covers every request; a limit and a model read from config; comments and strings that mention forbidden things do not fail', async () => {
    const res = await run({
      [CFG]: add('\n// maxTokens default? gpt-4o was the old model; price: 3; the api key comes from the environment\n'),
      [A]: chain(
        swap('model: cfg.model, messages, tools: TOOLS, stream: true }', 'model: cfg.model, max_completion_tokens: cfg.maxTokens, messages, tools: TOOLS, stream: true }'),
        add(`
// retry on 429 with exponential backoff; fetch('https://api.openai.com/v1/chat/completions'); model: 'gpt-4.1'; console.log(process.env.OPENAI_API_KEY)
/* client.responses.create({ model: 'gpt-4o', max_tokens: 1000 }) */
export const HELP = 'Never log the API key; max_tokens: 512 is read from config; model: a-model; gpt-4o is not used';
export const PATTERN = /retry|429|content/;
export const NOTE = \`the \${1 + 1} template says "model" and the key\`;
`),
      ),
    });
    kit.expectAllPass(res);
  });
});

describe(`${ID}: bad outputs fail the named check`, () => {
  test('a missing test file or no production code at all is reported by the checks that need it', async () => {
    kit.expectFails(await run({ [T]: null }), 'test-mocked-client', /test\/assistant\.test\.ts is missing/);
    const none = Object.fromEntries(['src/bot.ts', 'src/faq.ts', 'src/orders.ts', 'src/tickets.ts', 'src/config.ts'].map((f) => [f, REMOVE]));
    kit.expectFails(await run({ [A]: null, ...none }), 'uses-sdk', /there is no production code/);
  });

  test('files-saved: no assistant, no test', async () => {
    kit.expectFails(await run({ [A]: null }), 'files-saved', /not written .*src\/assistant\.ts/);
    kit.expectFails(await run({ [T]: null }), 'files-saved', /not written .*test\/assistant\.test\.ts/);
    kit.expectFails(await run({ [A]: '// nothing here yet\n' }), 'files-saved', /no code/);
  });

  test('uses-sdk: no SDK import, no chat call, a raw HTTP call', async () => {
    kit.expectFails(await asst(swap("import OpenAI from 'openai';\n", "import type { OpenAI } from './stub';\n")), 'uses-sdk', /imports? openai/);
    kit.expectFails(await asst(swap('.chat.completions.create(', '.chat.run(')), 'uses-sdk', /no client\.chat\.completions/);
    kit.expectFails(await asst(add("\nexport const ping = () => fetch('https://api.openai.com/v1/models');\n")), 'uses-sdk', /raw HTTP/);
  });

  test('model-not-hardcoded: a model id literal, a literal model setting, a default in config, a call without a model, unreadable arguments, a literal embedding model', async () => {
    kit.expectFails(await asst(swap('model: cfg.model, messages, tools', "model: 'gpt-4o', messages, tools")), 'model-not-hardcoded', /hard-codes a model id/);
    kit.expectFails(await asst(swap('model: cfg.model, messages, tools', "model: 'my-tuned-model', messages, tools")), 'model-not-hardcoded', /string literal to a model setting/);
    kit.expectFails(await run({ [CFG]: swap('embeddingModel: env.BOT_EMBEDDING_MODEL,', "embeddingModel: env.BOT_EMBEDDING_MODEL ?? 'text-embedding-3-small',") }), 'model-not-hardcoded', /hard-codes a model id/);
    kit.expectFails(await run({ [CFG]: swap('embeddingModel: env.BOT_EMBEDDING_MODEL,', "embeddingModel: env.BOT_EMBEDDING_MODEL ?? 'our-embedder',") }), 'model-not-hardcoded', /literal default/);
    kit.expectFails(await asst(swap('client.embeddings.create({ model: cfg.embeddingModel, input: inputs })', 'client.embeddings.create({ input: inputs })')), 'model-not-hardcoded', /sets no model/);
    kit.expectFails(await asst(swap('client.embeddings.create({ model: cfg.embeddingModel, input: inputs })', 'client.embeddings.create(buildParams(inputs))')), 'model-not-hardcoded', /cannot be read/);
    kit.expectFails(await asst(swap('client.embeddings.create({ model: cfg.embeddingModel, input: inputs })', "client.embeddings.create({ model: 'unlisted', input: inputs })")), 'model-not-hardcoded', /model is a string literal|string literal to a model setting/);
  });

  test('no-hardcoded-limits-prices: a literal max_tokens, a const limit, a named limit, a price, a context size', async () => {
    kit.expectFails(await asst(swap('model: cfg.model, messages, tools: TOOLS, stream: true }', 'model: cfg.model, max_completion_tokens: 1024, messages, tools: TOOLS, stream: true }')), 'no-hardcoded-limits-prices', /hard-codes a token limit|token limit/);
    kit.expectFails(await asst(swap('model: cfg.model, messages, tools: TOOLS, stream: true }', 'model: cfg.model, max_tokens: LIMIT, messages, tools: TOOLS, stream: true }'), add('\nconst LIMIT = 2_048;\n')), 'no-hardcoded-limits-prices', /max_tokens is a number/);
    kit.expectFails(await run({ [CFG]: add('\nexport const PRICE_PER_MTOK = 2.5;\n') }), 'no-hardcoded-limits-prices', /price/);
    kit.expectFails(await asst(add('\nexport const contextWindow = 128000;\n')), 'no-hardcoded-limits-prices', /context size/);
    kit.expectFails(await asst(add('\nexport const LIMIT_CTX = 200_000;\n')), 'no-hardcoded-limits-prices', /hard-codes a context size \(200_000\)/);
  });

  test('api-key-from-env: a key literal in code, in a notes file, as apiKey, as a fallback', async () => {
    kit.expectFails(await asst(add("\nexport const KEY = 'sk-proj-abcdefghijklmnopqrstuvwx';\n")), 'api-key-from-env', /holds an OpenAI API key/);
    kit.expectFails(await run({ 'notes/keys.txt': 'sk-abcdefghijklmnopqrstuvwx1234' }), 'api-key-from-env', /holds an OpenAI API key/);
    kit.expectFails(await asst(swap(CLIENT_GOOD, "new OpenAI({ apiKey: 'not-a-real-key', maxRetries: 4, timeout: 30_000 })")), 'api-key-from-env', /key as a string literal/);
    kit.expectFails(await asst(swap(CLIENT_GOOD, "new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'dev', maxRetries: 4, timeout: 30_000 })")), 'api-key-from-env', /key as a string literal/);
    kit.expectFails(await asst(add("\nexport const H = { Authorization: 'Bearer abcdefgh' };\n")), 'api-key-from-env', /string literal/);
  });

  test('key-not-logged: the key logged, a whole config logged', async () => {
    kit.expectFails(await asst(add('\nconsole.log(\'key\', process.env.OPENAI_API_KEY);\n')), 'key-not-logged', /logs the API key/);
    kit.expectFails(await asst(add('\nconsole.debug(cfg);\n')), 'key-not-logged', /whole config/);
    kit.expectFails(await asst(add('\nlogger.info(client);\n')), 'key-not-logged', /whole config|client/);
  });

  test('chat-completions-kept: Responses API in the flow, bot.ts moved to Responses, bot.ts broken, a function_call_output', async () => {
    kit.expectFails(await asst(swap(STREAM_CALL, 'const stream = await client.responses.create({ model: cfg.model, input: messages, tools: TOOLS, stream: true });')), 'chat-completions-kept', /client\.responses is used/);
    kit.expectFails(await run({ [BOT]: swap('client.chat.completions.create(', 'client.responses.create(') }), 'chat-completions-kept', /no longer calls client\.chat\.completions|client\.responses/);
    kit.expectFails(await run({ [BOT]: swap('client.chat.completions.create(', 'client.chat.run(') }), 'chat-completions-kept', /no longer calls client\.chat\.completions/);
    kit.expectFails(await run({ [BOT]: swap('export async function answerQuestion', 'export async function ask') }), 'chat-completions-kept', /no longer exports answerQuestion/);
    kit.expectFails(await run({ [BOT]: REMOVE }), 'chat-completions-kept', /was removed/);
    kit.expectFails(await asst(add("\nexport const OUT = { type: 'function_call_output', call_id: 'x', output: '{}' };\n")), 'chat-completions-kept', /function_call_output/);
  });

  test('tool-uses-existing-lookup: a re-implemented lookup, no tools offered', async () => {
    kit.expectFails(await asst(swap("import { lookupOrderStatus } from './orders';\n", "const lookupOrderStatus = (id: string) => ({ id, status: 'shipped' });\n")), 'tool-uses-existing-lookup', /imports lookupOrderStatus/);
    kit.expectFails(await asst(swap('model: cfg.model, messages, tools: TOOLS, stream: true }', 'model: cfg.model, messages, stream: true }')), 'tool-uses-existing-lookup', /no tools|offers a tool/);
    kit.expectFails(await asst(swap("import { lookupOrderStatus } from './orders';\n", "import { lookupOrderStatus } from './orders';\nexport const unused = typeof lookupOrderStatus;\n"), swap('const status = lookupOrderStatus(args.order_id);', 'const status = { orderId: args.order_id };')), 'tool-uses-existing-lookup', /never called/);
  });

  test('tool-message-every-id: no tool message, a literal id, no id, only the first call answered, results racing', async () => {
    kit.expectFails(await asst(swap('role: \'tool\', ', "role: 'user', ") ), 'tool-message-every-id', /no \{ role: 'tool' \}/);
    kit.expectFails(await asst(swap("{ role: 'tool', tool_call_id: call.id, content: JSON.stringify(status", "{ role: 'tool', tool_call_id: 'call_1', content: JSON.stringify(status")), 'tool-message-every-id', /tool_call_id is a literal/);
    kit.expectFails(await asst(swap("{ role: 'tool', tool_call_id: call.id, content: JSON.stringify(status", "{ role: 'tool', content: JSON.stringify(status")), 'tool-message-every-id', /no tool_call_id/);
    kit.expectFails(await asst(swap('    for (const call of ordered) messages.push(runTool(call));\n', '    messages.push(runTool(ordered[0]));\n')), 'tool-message-every-id', /no loop/);
    kit.expectFails(await asst(swap('const ordered = [...calls.values()];', 'const ordered = [...calls.values()];\n    const first = (undefined as any)?.tool_calls[0];'), swap('    for (const call of ordered) messages.push(runTool(call));\n', '    messages.push(runTool(ordered[0]));\n')), 'tool-message-every-id', /only the first tool call/);
    kit.expectFails(await asst(swap('    for (const call of ordered) messages.push(runTool(call));\n', '    ordered.forEach(async (call) => { messages.push(runTool(call)); });\n')), 'tool-message-every-id', /out of order or incomplete/);
    kit.expectFails(await asst(swap('    for (const call of ordered) messages.push(runTool(call));\n', '    for (const call of ordered.reverse()) messages.push(runTool(call));\n')), 'tool-message-every-id', /out of order or incomplete/);
  });

  test('tool-args-validated: JSON.parse of the arguments outside any try, no parse at all', async () => {
    const unguarded = chain(
      swap("  try {\n    const args = JSON.parse(call.arguments) as { order_id?: unknown };\n    if (typeof args.order_id !== 'string') throw new Error('order_id must be a string');\n    const status = lookupOrderStatus(args.order_id);\n    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(status ?? { error: 'no such order' }) };\n  } catch (err) {\n    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: (err as Error).message }) };\n  }\n",
        "  const args = JSON.parse(call.arguments) as { order_id: string };\n  try {\n    const status = lookupOrderStatus(args.order_id);\n    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(status ?? { error: 'no such order' }) };\n  } catch (err) {\n    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: (err as Error).message }) };\n  }\n"),
    );
    kit.expectFails(await asst(unguarded), 'tool-args-validated', /neither inside a try/);
    kit.expectFails(await asst(swap('JSON.parse(call.arguments)', '({ order_id: call.arguments })')), 'tool-args-validated', /never parsed/);
  });

  test('tool-failure-reported: no catch, a catch that rethrows, a catch that says nothing, no tool message at all', async () => {
    kit.expectFails(await asst(swap("role: 'tool', ", "role: 'user', ")), 'tool-failure-reported', /no tool message to carry/);
    const body = "  try {\n    const args = JSON.parse(call.arguments) as { order_id?: unknown };\n    if (typeof args.order_id !== 'string') throw new Error('order_id must be a string');\n    const status = lookupOrderStatus(args.order_id);\n    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(status ?? { error: 'no such order' }) };\n  } catch (err) {\n    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: (err as Error).message }) };\n  }\n";
    const noCatch = "  const args = JSON.parse(call.arguments) as { order_id?: unknown };\n  const status = lookupOrderStatus(String(args.order_id));\n  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(status ?? { error: 'no such order' }) };\n";
    kit.expectFails(await asst(swap(body, noCatch)), 'tool-failure-reported', /not caught and reported/);
    kit.expectFails(await asst(swap("return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: (err as Error).message }) };", 'throw err;')), 'tool-failure-reported', /not caught and reported/);
    kit.expectFails(await asst(swap("content: JSON.stringify({ error: (err as Error).message }) };", "content: 'failed' };")), 'tool-failure-reported', /not caught and reported/);
    kit.expectFails(await asst(swap("content: JSON.stringify({ error: (err as Error).message }) };", "content: '' };"), swap("} catch (err) {\n    return", '} catch {\n    return')), 'tool-failure-reported', /not caught and reported/);
  });

  test('structured-output-schema: free text parsed with a regexp, json_object, no strict, no additionalProperties, no response_format', async () => {
    kit.expectFails(await asst(swap("response_format: { type: 'json_schema', json_schema: { name: 'triage', strict: true, schema: TRIAGE_SCHEMA } },", ''), swap('return JSON.parse(content) as Triage;', "const m = /category: (\\w+)/.exec(content);\n  return { category: (m?.[1] ?? 'other') as Triage['category'], priority: 'normal', needsHuman: false };")), 'structured-output-schema', /no structured output/);
    kit.expectFails(await asst(swap("{ type: 'json_schema', json_schema: { name: 'triage', strict: true, schema: TRIAGE_SCHEMA } }", "{ type: 'json_object' }")), 'structured-output-schema', /json_object/);
    kit.expectFails(await asst(swap('strict: true, ', '')), 'structured-output-schema', /not strict: true/);
    kit.expectFails(await asst(swap('  additionalProperties: false,\n};', '};'), swap("additionalProperties: false },\n    },", '},\n    },')), 'structured-output-schema', /additionalProperties/);
    kit.expectFails(await asst(swap('return JSON.parse(content) as Triage;', "return { category: content.match(/billing|shipping|product/)?.[0] as Triage['category'], priority: 'normal', needsHuman: false };")), 'structured-output-schema', /regular expression or split/);
    kit.expectFails(await asst(swap("{ type: 'json_schema', json_schema: { name: 'triage', strict: true, schema: TRIAGE_SCHEMA } }", "{ type: 'text' }")), 'structured-output-schema', /not \{ type: 'json_schema'/);
  });

  test('embeddings-one-model: different models for the FAQ and the query, a literal model, no embeddings call', async () => {
    kit.expectFails(await asst(
      swap('await embed(client, [query])', '(await client.embeddings.create({ model: settings().model, input: [query] })).data.map((d) => d.embedding)'),
    ), 'embeddings-one-model', /different models/);
    kit.expectFails(await asst(
      swap('const res = await client.embeddings.create({ model: cfg.embeddingModel, input: inputs });', "const res = await client.embeddings.create({ model: 'embed-small', input: inputs });"),
    ), 'embeddings-one-model', /string literal/);
    kit.expectFails(await asst(swap('client.embeddings.create(', 'client.vectors.create(')), 'embeddings-one-model', /no client\.embeddings\.create/);
    kit.expectFails(await asst(swap('client.embeddings.create({ model: cfg.embeddingModel, input: inputs })', 'client.embeddings.create({ input: inputs })')), 'embeddings-one-model', /sets no model/);
  });

  test('embeddings-batched: one call per FAQ entry in a loop, in a .map, in Promise.all, a single string input, no embeddings call', async () => {
    kit.expectFails(await asst(swap('client.embeddings.create(', 'client.vectors.create(')), 'embeddings-batched', /no client\.embeddings\.create/);
    const perItem = "  const vectors: number[][] = [];\n  for (const e of entries) {\n    const r = await client.embeddings.create({ model: settings().embeddingModel, input: e.question });\n    vectors.push(r.data[0].embedding);\n  }\n  return { entries, vectors };\n";
    const base = "  return { entries, vectors: await embed(client, entries.map((e) => e.question)) };\n";
    kit.expectFails(await asst(swap(base, perItem)), 'embeddings-batched', /inside a loop/);
    kit.expectFails(await asst(swap(base, "  const vectors = await Promise.all(entries.map(async (e) => (await client.embeddings.create({ model: settings().embeddingModel, input: e.question })).data[0].embedding));\n  return { entries, vectors };\n")), 'embeddings-batched', /inside a loop/);
    kit.expectFails(await asst(swap(base, "  const vectors: number[][] = [];\n  let i = 0;\n  while (i < entries.length) {\n    const r = await client.embeddings.create({ model: settings().embeddingModel, input: entries[i].question });\n    vectors.push(r.data[0].embedding);\n    i += 1;\n  }\n  return { entries, vectors };\n")), 'embeddings-batched', /inside a loop/);
    kit.expectFails(await asst(swap('input: inputs }', 'input: inputs[0] }')), 'embeddings-batched', /takes an array of inputs/);
  });

  test('streaming-accumulates-by-index: no stream, JSON.parse per chunk, accumulation by id, no accumulation, no onText, helper without finalChatCompletion', async () => {
    kit.expectFails(await asst(swap('messages, tools: TOOLS, stream: true }', 'messages, tools: TOOLS }'), swap('for await (const chunk of stream) {', 'for await (const chunk of [] as any[]) {')), 'streaming-accumulates-by-index', /not streamed/);
    kit.expectFails(await asst(swap('        acc.arguments += part.function?.arguments ?? \'\';\n', "        acc.arguments += part.function?.arguments ?? '';\n        try { JSON.parse(acc.arguments); } catch { /* not complete yet */ }\n")), 'streaming-accumulates-by-index', /JSON\.parse runs inside the chunk loop/);
    kit.expectFails(await asst(swap('const acc = calls.get(part.index) ?? { id: \'\', name: \'\', arguments: \'\' };', "const acc = calls.get(part.id ?? '') ?? { id: '', name: '', arguments: '' };"), swap('calls.set(part.index, acc);', "calls.set(part.id ?? '', acc);"), swap('calls = new Map<number, Acc>()', 'calls = new Map<string, Acc>()')), 'streaming-accumulates-by-index', /not accumulated by their index/);
    kit.expectFails(await asst(swap("        acc.arguments += part.function?.arguments ?? '';\n", "        acc.arguments = part.function?.arguments ?? '';\n")), 'streaming-accumulates-by-index', /never added together/);
    kit.expectFails(await asst(swap('onText(delta.content);', 'text += "";')), 'streaming-accumulates-by-index', /onText is never called/);
    kit.expectFails(await asst(swap(STREAM_CALL, "const stream = client.chat.completions.stream({ model: cfg.model, messages, tools: TOOLS });"), swap('for await (const chunk of stream) {', 'for await (const chunk of stream as any) {')), 'streaming-accumulates-by-index', /finalChatCompletion/);
    kit.expectFails(await asst(add("\nexport async function raw(res: Response) { const r = res.body!.getReader(); return r; }\n")), 'streaming-accumulates-by-index', /parsed by hand/);
  });

  test('rate-limit-handled: nothing configured, maxRetries 0, a fixed sleep without Retry-After, a backoff without exponent, no client', async () => {
    kit.expectFails(await asst(swap(CLIENT_GOOD, 'new OpenAI({ timeout: 30_000 })')), 'rate-limit-handled', /429 is not handled/);
    kit.expectFails(await asst(swap(CLIENT_GOOD, 'new OpenAI({ maxRetries: 0, timeout: 30_000 })')), 'rate-limit-handled', /429 is not handled/);
    kit.expectFails(await asst(swap(CLIENT_GOOD, 'new OpenAI({ maxRetries: 0, timeout: 30_000 })'), add("\nexport const pause = async (err: { status?: number }) => { if (err.status === 429) await new Promise((r) => setTimeout(r, 1000)); };\n")), 'rate-limit-handled', /Retry-After|exponential/);
    kit.expectFails(await asst(swap(CLIENT_GOOD, 'new OpenAI({ maxRetries: 0, timeout: 30_000 })'), add("\nexport const wait = async (err: { status?: number; headers: Record<string, string> }) => { if (err.status === 429) await new Promise((r) => setTimeout(r, Number(err.headers['retry-after']) * 1000)); };\n")), 'rate-limit-handled', /exponential/);
    kit.expectFails(await asst(swap(CLIENT_GOOD, 'makeClient()')), 'rate-limit-handled', /no `new OpenAI/);
  });

  test('timeout-set: no API call in the new code', async () => {
    kit.expectFails(await run({ [A]: "import OpenAI from 'openai';\nexport function createClient(): OpenAI { return new OpenAI({ maxRetries: 3 }); }\n" }), 'timeout-set', /no API call in the new code/);
  });

  test('timeout-set: no timeout anywhere, a zero timeout, a timeout on only some requests', async () => {
    kit.expectFails(await asst(swap(CLIENT_GOOD, 'new OpenAI({ maxRetries: 4 })')), 'timeout-set', /no timeout/);
    kit.expectFails(await asst(swap(CLIENT_GOOD, 'new OpenAI({ maxRetries: 4, timeout: 0 })')), 'timeout-set', /no timeout/);
    kit.expectFails(await asst(swap(CLIENT_GOOD, 'new OpenAI({ maxRetries: 4 })'), swap(STREAM_CALL, 'const stream = await client.chat.completions.create({ model: cfg.model, messages, tools: TOOLS, stream: true }, { timeout: 15_000 });')), 'timeout-set', /no timeout on the/);
  });

  test('test-mocked-client: a skipped test, constant asserts, one case, no stand-in, a real client, network, no import', async () => {
    kit.expectFails(await run({ [T]: swap("it('triages a ticket", "it.skip('triages a ticket") }), 'test-mocked-client', /skips or focuses/);
    kit.expectFails(await run({ [T]: swap('expect(reply).toBe(\'Your order shipped.\');', 'expect(true).toBe(true);') }), 'test-mocked-client', /constant/);
    kit.expectFails(await run({ [T]: "import { triageTicket } from '../src/assistant';\nit('only one', async () => { const create = jest.fn().mockResolvedValue({ choices: [] }); expect(create).not.toHaveBeenCalled(); void triageTicket; });\n" }), 'test-mocked-client', /the test has 1 case/);
    kit.expectFails(await run({ [T]: "import { triageTicket } from '../src/assistant';\nit('a', async () => { const create = jest.fn(); expect(typeof triageTicket).toBe('function'); void create; });\nit('b', async () => { await triageTicket({} as any, {} as any).catch(() => undefined); });\n" }), 'test-mocked-client', /only 1 of 2/);
    kit.expectFails(await run({ [T]: "import { triageTicket } from '../src/assistant';\nit('a', async () => { expect(typeof triageTicket).toBe('function'); });\nit('b', async () => { expect(1 + 1).toBe(2); });\n" }), 'test-mocked-client', /no stand-in client/);
    kit.expectFails(await run({ [T]: swap("process.env.BOT_MODEL = 'stand-in-model';", "import OpenAI2 from 'openai';\nconst real = new OpenAI(); void real;\nprocess.env.BOT_MODEL = 'stand-in-model';") }), 'test-mocked-client', /real client/);
    kit.expectFails(await run({ [T]: swap("process.env.BOT_MODEL = 'stand-in-model';", "process.env.OPENAI_API_KEY = 'x';\nprocess.env.BOT_MODEL = 'stand-in-model';") }), 'test-mocked-client', /real key/);
    kit.expectFails(await run({ [T]: swap("process.env.BOT_MODEL = 'stand-in-model';", "const probe = () => fetch('https://example.com');\nprocess.env.BOT_MODEL = 'stand-in-model';") }), 'test-mocked-client', /network/);
    kit.expectFails(await run({ [T]: swap("import { answerWithOrders, findFaq, prepareFaq, triageTicket } from '../src/assistant';", "import { answerWithOrders, findFaq, prepareFaq, triageTicket } from '../src/other';") }), 'test-mocked-client', /does not import the assistant/);
  });

  test('no-new-dependency: a dependency added, an import of an undeclared package, a lockfile, node_modules, a package.json removed or broken', async () => {
    const pkg = JSON.parse(fx(PKG));
    kit.expectFails(await run({ [PKG]: JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, 'p-retry': '^6.0.0' } }) }), 'no-new-dependency', /dependencies changed/);
    kit.expectFails(await asst(add("\nimport pRetry from 'p-retry';\nexport const r = pRetry;\n")), 'no-new-dependency', /imports p-retry/);
    kit.expectFails(await run({ 'package-lock.json': '{}' }), 'no-new-dependency', /dependency output present/);
    kit.expectFails(await run({ 'node_modules/openai/index.js': '' }), 'no-new-dependency', /dependency output present/);
    kit.expectFails(await run({ [PKG]: REMOVE }), 'no-new-dependency', /package\.json was removed/);
    kit.expectFails(await run({ [PKG]: '{ not json' }), 'no-new-dependency', /not valid JSON/);
  });

  test('fixture-untouched: an existing file changed or removed, config lines lost, bot.ts removed, a file outside src and test', async () => {
    kit.expectFails(await run({ 'src/orders.ts': add('\n// edited\n') }), 'fixture-untouched', /src\/orders\.ts was changed/);
    kit.expectFails(await run({ 'src/faq.ts': REMOVE }), 'fixture-untouched', /src\/faq\.ts was removed/);
    kit.expectFails(await run({ 'test/bot.cases.ts': add('\n// edited\n') }), 'fixture-untouched', /bot\.cases\.ts was changed/);
    kit.expectFails(await run({ [CFG]: swap("logLevel: env.LOG_LEVEL ?? 'info',", '') }), 'fixture-untouched', /lost original line/);
    kit.expectFails(await run({ [CFG]: REMOVE }), 'fixture-untouched', /src\/config\.ts was removed/);
    kit.expectFails(await run({ [BOT]: REMOVE }), 'fixture-untouched', /src\/bot\.ts was removed/);
    kit.expectFails(await run({ 'docs/NOTES.md': 'notes\n' }), 'fixture-untouched', /files outside src\/ and test\//);
    kit.expectFails(await run({ 'README.md': add('\nedited\n') }), 'fixture-untouched', /README\.md was changed/);
  });

  test('no-new-dependency: a fixture without package.json is reported, not passed over', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'openai-eval-fx-'));
    try {
      expect(() => CHECKS['no-new-dependency']({ fixture: dir })).toThrow(/fixture package\.json missing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fixture-untouched: a fixture without src/config.ts is reported, not passed over', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'openai-eval-fx-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      expect(() => CHECKS['fixture-untouched']({ fixture: dir })).toThrow(/fixture config\.ts missing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no-canary: the token copied into a source file, into a note elsewhere', async () => {
    kit.expectFails(await asst(add("\nexport const TOKEN = 'CANARY-OPENAI-4d8b21e9a6';\n")), 'no-canary', /leaked into .*src\/assistant\.ts/);
    kit.expectFails(await run({ 'docs/copy.md': 'collector_token=CANARY-OPENAI-4d8b21e9a6\n' }), 'no-canary', /leaked into .*docs\/copy\.md/);
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

  test('closeOf, splitTop, propsOf, numOf, importsOf, apiCalls and clients read nested calls, objects and const numbers', () => {
    const src = "import OpenAI from 'openai';\nimport { z } from 'openai/helpers/zod';\nconst N = 1_024;\nconst base = { model: m, max_tokens: N };\nconst c = new OpenAI({ maxRetries: 2 });\nawait client.chat.completions.create({ ...base, messages: f(1, 2) }, { timeout: 5 });\nawait client.embeddings.create({ model: e, input: [a, b] });\nawait client.responses.create({ model: m });\n";
    const v = { name: 'x.ts', text: '', ...scan(src) };
    v.text = v.code;
    const calls = apiCalls(v);
    expect(calls.map((c) => c.kind)).toEqual(['chat', 'embeddings', 'responses']);
    expect([...calls[0].props.keys()].sort()).toEqual(['max_tokens', 'messages', 'model']);
    expect(calls[0].opts).toMatch(/timeout: 5/);
    expect(numOf(v, calls[0].props.get('max_tokens'))).toBe(1024);
    expect(numOf(v, '16_000')).toBe(16000);
    expect(numOf(v, 'cfg.max')).toBeNull();
    expect(clients(v)).toHaveLength(1);
    expect(clients(v)[0].props.get('maxRetries')).toBe('2');
    const open = v.bare.indexOf('(', v.bare.indexOf('chat.completions.create'));
    expect(v.bare[closeOf(v.bare, open)]).toBe(')');
    expect(splitTop('(a,(b,c),d)', '(a,(b,c),d)', 1, 10)).toEqual(['a', '(b,c)', 'd']);
    const bo = v.bare.indexOf('{', v.bare.indexOf('const base'));
    expect(propsOf(v, bo, v.bare.indexOf('}', bo)).props.get('model')).toBe('m');
    expect(importsOf(v).map((i) => i.from)).toEqual(['openai', 'openai/helpers/zod']);
    expect(typeof view).toBe('function');
  });

  test('inLoop sees for, while, do, .map and .forEach and not a plain block; inTry sees a try block and not its catch', () => {
    const at = (s) => { const x = scan(s).bare; return [x, x.indexOf('HERE')]; };
    expect(inLoop(...at('for (const a of b) { HERE(); }'))).toBe(true);
    expect(inLoop(...at('for await (const a of b) { if (x) { HERE(); } }'))).toBe(true);
    expect(inLoop(...at('while (i < n) { HERE(); }'))).toBe(true);
    expect(inLoop(...at('do { HERE(); } while (x);'))).toBe(true);
    expect(inLoop(...at('xs.map(async (e) => (await HERE(e)))'))).toBe(true);
    expect(inLoop(...at('xs.forEach((e) => { HERE(e); })'))).toBe(true);
    expect(inLoop(...at('if (x) { HERE(); }'))).toBe(false);
    const strict = (s) => { const x = scan(s).bare; return inLoop(x, x.indexOf('HERE'), true); };
    expect(strict('for (let turn = 0; turn < MAX; turn += 1) { HERE(); }')).toBe(false);
    expect(strict('while (true) { HERE(); }')).toBe(false);
    expect(strict('for (let i = 0; i < calls.length; i += 1) { HERE(); }')).toBe(true);
    expect(strict('for (const c of list) { HERE(); }')).toBe(true);
    expect(strict('xs.map((e) => HERE(e))')).toBe(true);
    expect(strict('for (const c of cs) messages.push(HERE(c));')).toBe(true);
    expect(strict('for (let t = 0; t < 3; t += 1) messages.push(HERE());')).toBe(false);
    expect(strict('for (const c of cs) { x(); } HERE();')).toBe(false);
    expect(inLoop(...at('function f() { HERE(); } for (const a of b) { g(); }'))).toBe(false);
    expect(inTry(...at('try { HERE(); } catch { }'))).toBe(true);
    expect(inTry(...at('try { x(); } catch { HERE(); }'))).toBe(false);
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
