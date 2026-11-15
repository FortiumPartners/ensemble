'use strict';

/**
 * Kit tests for the `anthropic` skill eval: a good output passes every check, differently phrased good outputs do too, and bad outputs
 * each fail the named check (with the reason that check gives). No model is called; the "agent" is a function that writes the files a
 * good or a bad run would leave. The TypeScript below is never compiled or run; it is only text for the static checks.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const kit = require('../skill-eval-kit');
const { CHECKS, scan, closeOf, splitTop, anthropicCalls, propsOf, numOf, importsOf, view } = require('../../checks/anthropic');

jest.setTimeout(120000); // each run spawns one node process per check

const ID = 'anthropic';
const IDS = [
  'files-saved', 'uses-sdk', 'model-not-hardcoded', 'no-hardcoded-limits-prices', 'api-key-from-env', 'key-not-logged', 'max-tokens-every-call',
  'stop-reason-handled', 'streams-answer', 'tool-uses-existing-lookup', 'tool-results-every-id', 'tool-error-flagged', 'thinking-for-hard',
  'thinking-budget-below-max', 'assistant-turn-verbatim', 'cache-control-present', 'cache-on-stable-prefix', 'cache-not-on-volatile',
  'policy-doc-loaded', 'no-custom-retry', 'test-mocked-client', 'no-new-dependency', 'fixture-untouched', 'no-canary',
];
const FIXTURE = path.resolve(__dirname, '../../skills/anthropic/fixture');
const fx = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const A = 'src/assistant.ts';
const T = 'test/assistant.test.ts';
const CFG = 'src/config.ts';
const PKG = 'package.json';

const GOOD_CONFIG = fx(CFG)
  .replace('  policyPath: string;\n', '  policyPath: string;\n  model: string | undefined;\n  summaryMaxTokens: number;\n')
  .replace("    policyPath: env.POLICY_PATH ?? 'docs/refund-policy.md',\n", "    policyPath: env.POLICY_PATH ?? 'docs/refund-policy.md',\n    model: env.CLAUDE_MODEL,\n    summaryMaxTokens: Number(env.SUMMARY_MAX_TOKENS ?? '300'),\n");

const GOOD_ASSISTANT = `import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { loadConfig } from './config';
import { lookupOrderStatus } from './orders';
import type { Ticket } from './tickets';

const MAX_ANSWER_TOKENS = 4096;
const THINKING_BUDGET = 2048;
const MAX_TURNS = 6;

/** The SDK reads ANTHROPIC_API_KEY from the environment and retries 429 and 5xx on its own. */
export function createClient(): Anthropic {
  return new Anthropic({ maxRetries: 3 });
}

function settings() {
  const cfg = loadConfig();
  if (!cfg.model) throw new Error('CLAUDE_MODEL is not set');
  return { ...cfg, model: cfg.model };
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'lookup_order_status',
    description: 'Look up the status of one order by its id.',
    input_schema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] },
    cache_control: { type: 'ephemeral' },
  },
];

function systemBlocks(): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: 'You write short, polite replies to the customers of a web shop.' },
    { type: 'text', text: readFileSync(loadConfig().policyPath, 'utf8'), cache_control: { type: 'ephemeral' } },
  ];
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
}

export async function summarizeTicket(client: Anthropic, ticket: Ticket): Promise<string> {
  const cfg = settings();
  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: cfg.summaryMaxTokens,
    messages: [{ role: 'user', content: 'Summarize this ticket in one sentence: ' + ticket.subject + ' ' + ticket.body }],
  });
  if (response.stop_reason === 'refusal') throw new Error('the model declined to summarize');
  return textOf(response.content);
}

function runTool(use: Anthropic.ToolUseBlock): Anthropic.ToolResultBlockParam {
  try {
    const status = lookupOrderStatus(String((use.input as { order_id?: string }).order_id));
    return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(status ?? { error: 'no such order' }) };
  } catch (err) {
    return { type: 'tool_result', tool_use_id: use.id, content: (err as Error).message, is_error: true };
  }
}

export async function answerTicket(client: Anthropic, ticket: Ticket, onText: (piece: string) => void): Promise<string> {
  const cfg = settings();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: ticket.subject + '\\n\\n' + ticket.body }];
  let reply = '';
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const stream = client.messages.stream({
      model: cfg.model,
      max_tokens: MAX_ANSWER_TOKENS,
      system: systemBlocks(),
      tools: TOOLS,
      messages,
      ...(ticket.escalated ? { thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET } } : {}),
    });
    stream.on('text', (piece) => { onText(piece); });
    const message = await stream.finalMessage();
    reply += textOf(message.content);
    if (message.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: message.content });
      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const results = toolUses.map((use) => runTool(use));
      messages.push({ role: 'user', content: results });
      continue;
    }
    if (message.stop_reason === 'max_tokens') throw new Error('the reply was cut off');
    if (message.stop_reason === 'refusal') throw new Error('the model declined to answer');
    return reply;
  }
  throw new Error('too many tool turns');
}
`;

const GOOD_TEST = `import { answerTicket, summarizeTicket } from '../src/assistant';

process.env.CLAUDE_MODEL = 'stand-in-model';

const ticket = { id: '7', customer: 'Ada', subject: 'Where is ORD-1001?', body: 'It has not arrived.', escalated: false };

function fakeStream(message: unknown) {
  return { on: jest.fn((_event: string, cb: (t: string) => void) => { cb('Hello'); }), finalMessage: async () => message };
}

describe('assistant', () => {
  it('summarizes a ticket with one call and returns the text', async () => {
    const create = jest.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Where is the order.' }] });
    const client = { messages: { create } } as any;
    await expect(summarizeTicket(client, ticket)).resolves.toBe('Where is the order.');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('answers a tool call with a tool_result for every tool_use id, in order', async () => {
    const toolUse = { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'u1', name: 'lookup_order_status', input: { order_id: 'ORD-1001' } },
      { type: 'tool_use', id: 'u2', name: 'lookup_order_status', input: { order_id: 'bad' } },
    ] };
    const done = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Shipped.' }] };
    const stream = jest.fn().mockReturnValueOnce(fakeStream(toolUse)).mockReturnValueOnce(fakeStream(done));
    const client = { messages: { stream } } as any;
    const pieces: string[] = [];
    const reply = await answerTicket(client, ticket, (p) => pieces.push(p));
    const second = stream.mock.calls[1][0].messages;
    const results = second[second.length - 1].content;
    expect(results.map((r: { tool_use_id: string }) => r.tool_use_id)).toEqual(['u1', 'u2']);
    expect(results[1].is_error).toBe(true);
    expect(reply).toContain('Shipped.');
    expect(pieces.length).toBeGreaterThan(0);
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
/** Run with an extra file (a new path, or REMOVE it). */
const withFile = (rel, text) => run({ [rel]: text });
const asst = (...fns) => run({ [A]: chain(...fns) });

describe(`${ID}: the eval and the good output`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration, no .gitignore that could hide the canary, no .js file jest could pick up', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude', 'pi']);
    expect(fs.existsSync(path.join(FIXTURE, 'notes/collector.conf'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE, '.gitignore'))).toBe(false);
    const walkAll = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkAll(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walkAll(FIXTURE);
    expect(files.filter((f) => /\.m?[jt]sx?$/.test(f) && !/\.(?:cases|d)\.ts$/.test(f) && !/\/src\//.test(f))).toEqual([]);
    expect(files.filter((f) => /\.js$/.test(f))).toEqual([]);
    expect(fs.statSync(path.join(FIXTURE, 'docs/refund-policy.md')).size).toBeGreaterThan(5000); // long enough that caching it is worth it
  });

  test('a good feature passes every check, and the checks are exactly the expected ones in order', async () => {
    const res = await run();
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every check about the output; the guards (no change to the fixture, no canary, no new dependency) pass', async () => {
    const res = await kit.runEval(ID, () => {});
    const failing = Object.keys(res).filter((k) => !res[k].pass).sort();
    const vacuous = ['model-not-hardcoded', 'no-hardcoded-limits-prices', 'api-key-from-env', 'key-not-logged', 'thinking-budget-below-max', 'cache-not-on-volatile', 'no-custom-retry'];
    const guards = ['no-new-dependency', 'fixture-untouched', 'no-canary'];
    expect(failing).toEqual(IDS.filter((k) => !vacuous.includes(k) && !guards.includes(k)).sort());
  });

  test('every check id of eval.json has at least one bad output in this file that names it', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    const bad = src.slice(src.indexOf('describe(`${ID}: bad'));
    for (const id of IDS) expect({ id, named: new RegExp(`['"]${id}['"]`).test(bad) }).toEqual({ id, named: true });
  });

  test('the prompt names no convention under test', () => {
    const ev = kit.getEval(ID);
    expect(ev.prompt).not.toMatch(/ANTHROPIC_API_KEY|max_tokens|stop_reason|tool_result|tool_use|is_error|cache_control|budget_tokens|thinking|retry|retries|backoff|cache|caching|ephemeral|api[ _-]?key|environment variable|\benv\b|refusal|sdk/i);
    expect(ev.prompt).toMatch(/src\/assistant\.ts/);
    expect(ev.prompt).toMatch(/test\/assistant\.test\.ts/);
    expect(ev.prompt).toMatch(/src\/config\.ts/);
  });
});

describe(`${ID}: differently phrased good outputs pass`, () => {
  test('template literals, an apiKey read from the environment, an options object held in a const, adaptive thinking, a for...of loop and a Promise.all', async () => {
    const res = await run({
      [A]: chain(
        swap("new Anthropic({ maxRetries: 3 })", 'new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 })'),
        swap("'Summarize this ticket in one sentence: ' + ticket.subject + ' ' + ticket.body", '`Summarize this ticket in one sentence: ${ticket.subject} (${`${ticket.id}`}) ${ticket.body}`'),
        swap("{ thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET } }", "{ thinking: { type: 'adaptive' as const } }"),
        swap("    const stream = client.messages.stream({\n      model: cfg.model,\n      max_tokens: MAX_ANSWER_TOKENS,\n      system: systemBlocks(),\n      tools: TOOLS,\n      messages,\n",
          "    const params = {\n      model: cfg.model,\n      max_tokens: MAX_ANSWER_TOKENS,\n      system: systemBlocks(),\n      tools: TOOLS,\n      messages,\n"),
        swap("    });\n    stream.on('text'", "    };\n    const stream = client.messages.stream(params);\n    stream.on('text'"),
        swap("      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');\n      const results = toolUses.map((use) => runTool(use));\n",
          "      const results: Anthropic.ToolResultBlockParam[] = [];\n      for (const block of message.content) {\n        if (block.type === 'tool_use') results.push(runTool(block));\n      }\n"),
      ),
    });
    kit.expectAllPass(res);
  });

  test('a content-block loop with Promise.all, a cache_control on the last tool only, retries configured on the client, a model from a config object', async () => {
    const res = await run({
      [A]: chain(
        swap("    { type: 'text', text: readFileSync(loadConfig().policyPath, 'utf8'), cache_control: { type: 'ephemeral' } },\n", "    { type: 'text', text: readFileSync(loadConfig().policyPath, 'utf8') },\n"),
        swap("      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');\n      const results = toolUses.map((use) => runTool(use));\n",
          "      const results = await Promise.all(message.content.filter((b) => b.type === 'tool_use').map(async (use) => runTool(use as Anthropic.ToolUseBlock)));\n"),
        swap('const MAX_ANSWER_TOKENS = 4096;', 'const MAX_ANSWER_TOKENS = 16_000;'),
      ),
    });
    kit.expectAllPass(res);
  });

  test('a stand-in client written as a plain object with no jest mock, and a reply built by a streaming loop with text_delta', async () => {
    const res = await run({
      [T]: chain(
        swap('jest.fn((_event: string, cb: (t: string) => void) => { cb(\'Hello\'); })', '(_event: string, cb: (t: string) => void) => { cb(\'Hello\'); }'),
        swap('const create = jest.fn().mockResolvedValue(', 'const create = async () => ('),
        swap('const stream = jest.fn().mockReturnValueOnce(fakeStream(toolUse)).mockReturnValueOnce(fakeStream(done));', 'const calls: any[] = []; const queue = [fakeStream(toolUse), fakeStream(done)]; const stream = (p: any) => { calls.push([p]); return queue.shift(); }; stream.mock = { calls };'),
        swap('expect(create).toHaveBeenCalledTimes(1);', 'expect(typeof create).toBe("function");'),
      ),
    });
    kit.expectAllPass(res);
  });

  test('a comment, a string or a regexp that mentions a forbidden thing does not fail any check', async () => {
    const res = await run({
      [A]: add(`
// retry with backoff on 429? no: the SDK does it. model: 'claude-sonnet-4-5' console.log(process.env.ANTHROPIC_API_KEY)
/* fetch('https://api.anthropic.com/v1/messages'); cache_control: { type: 'ephemeral' } */
export const HELP = 'Do not retry here; status 429 is handled by the SDK; model: a-model; console.log(config)';
export const PATTERN = /retry|attempt|429/;
export const NOTE = \`the \${1 + 1} template says "a model" and retry\`;
`),
    });
    kit.expectAllPass(res);
  });
});

describe(`${ID}: bad outputs fail the named check`, () => {
  test('files-saved: no assistant, no test', async () => {
    kit.expectFails(await run({ [A]: null }), 'files-saved', /not written .*src\/assistant\.ts/);
    kit.expectFails(await run({ [T]: null }), 'files-saved', /not written .*test\/assistant\.test\.ts/);
    kit.expectFails(await run({ [A]: '// nothing here yet\n' }), 'files-saved', /no code/);
  });

  test('uses-sdk: no SDK import, no call, a raw HTTP call', async () => {
    kit.expectFails(await asst(swap("import Anthropic from '@anthropic-ai/sdk';\n", '')), 'uses-sdk', /imports? @anthropic-ai\/sdk/);
    kit.expectFails(await asst(swap('.messages.stream(', '.stream('), swap('.messages.create(', '.create(')), 'uses-sdk', /no client\.messages/);
    kit.expectFails(await asst(add("\nexport const ping = () => fetch('https://api.anthropic.com/v1/messages', { method: 'POST' });\n")), 'uses-sdk', /raw HTTP/);
  });

  test('model-not-hardcoded: a model id literal, a literal model setting, a default in config, a call without a model, unreadable arguments', async () => {
    kit.expectFails(await asst(swap('model: cfg.model,', "model: 'claude-sonnet-4-5',")), 'model-not-hardcoded', /hard-codes a model id/);
    kit.expectFails(await asst(swap('model: cfg.model,', "model: 'my-tuned-model',")), 'model-not-hardcoded', /string literal to a model setting/);
    kit.expectFails(await run({ [CFG]: swap('model: env.CLAUDE_MODEL,', "model: env.CLAUDE_MODEL ?? 'claude-opus-4-1',") }), 'model-not-hardcoded', /hard-codes a model id/);
    kit.expectFails(await asst(swap('      model: cfg.model,\n      max_tokens: MAX_ANSWER_TOKENS,', '      max_tokens: MAX_ANSWER_TOKENS,')), 'model-not-hardcoded', /sets no model/);
    kit.expectFails(await asst(swap('client.messages.stream({', 'client.messages.stream(buildParams(ticket, messages, {'), swap("      ...(ticket.escalated ? { thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET } } : {}),\n    });", "    }));")), 'model-not-hardcoded', /cannot be read/);
  });

  test('no-hardcoded-limits-prices: a context size, a named context window, a price', async () => {
    kit.expectFails(await asst(add('\nconst CONTEXT = 200000;\n')), 'no-hardcoded-limits-prices', /context size \(200000\)/);
    kit.expectFails(await asst(add('\nconst contextWindow = 150000;\n')), 'no-hardcoded-limits-prices', /context size or a price/);
    kit.expectFails(await asst(add('\nconst PRICE_PER_MTOK_INPUT = 3;\n')), 'no-hardcoded-limits-prices', /context size or a price/);
  });

  test('api-key-from-env: a key in a file, a key literal for the client, a literal fallback', async () => {
    kit.expectFails(await withFile('src/dev.ts', "export const DEV_KEY = 'sk-ant-api03-abcdef0123456789';\n"), 'api-key-from-env', /holds an Anthropic API key/);
    kit.expectFails(await asst(swap('new Anthropic({ maxRetries: 3 })', "new Anthropic({ apiKey: 'dev-key-123', maxRetries: 3 })")), 'api-key-from-env', /key as a string literal/);
    kit.expectFails(await asst(swap('new Anthropic({ maxRetries: 3 })', "new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? 'fallback' })")), 'api-key-from-env', /key as a string literal/);
  });

  test('key-not-logged: the key in a log line, a whole config object logged', async () => {
    kit.expectFails(await asst(swap('  return new Anthropic({ maxRetries: 3 });', "  console.log('using key', process.env.ANTHROPIC_API_KEY);\n  return new Anthropic({ maxRetries: 3 });")), 'key-not-logged', /logs the API key/);
    kit.expectFails(await asst(swap('  const cfg = loadConfig();\n  if', '  const cfg = loadConfig();\n  console.log(cfg);\n  if')), 'key-not-logged', /whole config/);
  });

  test('max-tokens-every-call: missing on a call, zero, helper-built request, no call at all', async () => {
    kit.expectFails(await asst(swap('      max_tokens: MAX_ANSWER_TOKENS,\n', '')), 'max-tokens-every-call', /sets no max_tokens/);
    kit.expectFails(await asst(swap('    max_tokens: cfg.summaryMaxTokens,\n', '')), 'max-tokens-every-call', /messages\.create sets no max_tokens/);
    kit.expectFails(await asst(swap('max_tokens: MAX_ANSWER_TOKENS,', 'max_tokens: 0,')), 'max-tokens-every-call', /is zero/);
    kit.expectFails(await asst(swap('client.messages.stream({', 'client.messages.stream(buildParams(messages, {'), swap("      ...(ticket.escalated ? { thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET } } : {}),\n    });", "    }));")), 'max-tokens-every-call', /cannot be read/);
    kit.expectFails(await asst(swap('.messages.stream(', '.stream('), swap('.messages.create(', '.create(')), 'max-tokens-every-call', /no messages\.create or messages\.stream call/);
  });

  test('stop-reason-handled: stop_reason never read, a value missing', async () => {
    kit.expectFails(await asst(swap('.stop_reason', '.stopped')), 'stop-reason-handled', /reads stop_reason/);
    kit.expectFails(await asst(swap("message.stop_reason === 'refusal'", "message.stop_reason === 'other'"), swap("response.stop_reason === 'refusal'", "response.stop_reason === 'other'")), 'stop-reason-handled', /not handled: refusal/);
    kit.expectFails(await asst(swap("message.stop_reason === 'max_tokens'", "message.stop_reason === 'done'")), 'stop-reason-handled', /not handled: max_tokens/);
  });

  test('streams-answer: not streamed, parsed by hand, no finalMessage, text not taken from the stream, onText never called', async () => {
    kit.expectFails(await asst(swap('client.messages.stream(', 'client.messages.create('), swap('stream.on(', 'stream.addListener(')), 'streams-answer', /not streamed/);
    kit.expectFails(await asst(add('\nexport const read = (res: Response) => res.body!.getReader();\n')), 'streams-answer', /parsed by hand/);
    kit.expectFails(await asst(swap('await stream.finalMessage()', 'await stream.done()')), 'streams-answer', /finalMessage\(\) is never awaited/);
    kit.expectFails(await asst(swap("stream.on('text'", "stream.on('end'")), 'streams-answer', /text is not taken from the stream/);
    kit.expectFails(await asst(swap('onText(piece);', 'void piece;')), 'streams-answer', /onText is never called/);
  });

  test('tool-uses-existing-lookup: not imported, not called, no tool definition', async () => {
    kit.expectFails(await asst(swap("import { lookupOrderStatus } from './orders';\n", '')), 'tool-uses-existing-lookup', /imports lookupOrderStatus/);
    kit.expectFails(await asst(swap('lookupOrderStatus(String(', 'lookupStub(String(')), 'tool-uses-existing-lookup', /never called/);
    kit.expectFails(await asst(swap('input_schema:', 'schema:')), 'tool-uses-existing-lookup', /no input_schema/);
  });

  test('tool-results-every-id: no tool_result, no id, a literal id, an unbuilt block, one block answered, no loop, results not in a user message, reordered', async () => {
    kit.expectFails(await asst(swap("type: 'tool_result'", "type: 'tool_output'")), 'tool-results-every-id', /no tool_result block is ever sent back/);
    kit.expectFails(await asst(swap('tool_use_id: use.id, ', '')), 'tool-results-every-id', /has no tool_use_id/);
    kit.expectFails(await asst(swap('tool_use_id: use.id', "tool_use_id: 'toolu_01'")), 'tool-results-every-id', /tool_use_id is a literal/);
    kit.expectFails(await asst(swap("type: 'tool_result'", 'type: KIND'), add("\nconst KIND = 'tool_result';\n")), 'tool-results-every-id', /builds no \{ type: 'tool_result' \} block/);
    const one = "      const first = message.content.find((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock;\n      const results = [runTool(first)];\n";
    const loop = "      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');\n      const results = toolUses.map((use) => runTool(use));\n";
    kit.expectFails(await asst(swap(loop, one)), 'tool-results-every-id', /answers one tool_use block \(\.find\)/);
    kit.expectFails(await asst(swap(loop, "      const results = [runTool(message.content[1] as Anthropic.ToolUseBlock)];\n")), 'tool-results-every-id', /no loop or filter over the tool_use blocks/);
    kit.expectFails(await asst(swap("{ role: 'user', content: results }", "{ role: 'assistant', content: results }")), 'tool-results-every-id', /not sent back in a user message/);
    kit.expectFails(await asst(swap('const results = toolUses.map((use) => runTool(use));\n', 'const results = toolUses.map((use) => runTool(use));\n      results.reverse();\n')), 'tool-results-every-id', /out of order/);
  });

  test('tool-error-flagged: no catch, no is_error', async () => {
    kit.expectFails(await asst(swap('} catch (err) {', '} finally {'), swap('(err as Error).message', "'failed'")), 'tool-error-flagged', /never caught/);
    kit.expectFails(await asst(swap(', is_error: true', '')), 'tool-error-flagged', /not reported to the model with is_error/);
    kit.expectFails(await asst(swap('is_error: true', 'is_error: false')), 'tool-error-flagged', /not reported to the model with is_error/);
  });

  test('thinking-for-hard: none, always on, ticket.escalated never read', async () => {
    const spread = "      ...(ticket.escalated ? { thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET } } : {}),\n";
    kit.expectFails(await asst(swap(spread, '')), 'thinking-for-hard', /no extended thinking/);
    kit.expectFails(await asst(swap(spread, "      thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET },\n"), swap("let reply = '';", "let reply = ''; const hard = ticket.escalated;")), 'thinking-for-hard', /switched on for every ticket/);
    kit.expectFails(await asst(swap('ticket.escalated ?', 'true ?')), 'thinking-for-hard', /escalated is never read/);
  });

  test('thinking-budget-below-max: not below, below the API minimum, enabled without a budget', async () => {
    kit.expectFails(await asst(swap('THINKING_BUDGET = 2048', 'THINKING_BUDGET = 8192')), 'thinking-budget-below-max', /budget_tokens 8192 must be below max_tokens \(4096\)/);
    kit.expectFails(await asst(swap('THINKING_BUDGET = 2048', 'THINKING_BUDGET = 4096')), 'thinking-budget-below-max', /must be below max_tokens/);
    kit.expectFails(await asst(swap('THINKING_BUDGET = 2048', 'THINKING_BUDGET = 512')), 'thinking-budget-below-max', /below the API minimum of 1024/);
    kit.expectFails(await asst(swap(', budget_tokens: THINKING_BUDGET', '')), 'thinking-budget-below-max', /has no budget_tokens/);
  });

  test('assistant-turn-verbatim: no assistant message, a filtered one, a rebuilt one, one via a variable', async () => {
    const push = "      messages.push({ role: 'assistant', content: message.content });\n";
    kit.expectFails(await asst(swap(push, '')), 'assistant-turn-verbatim', /never appends an assistant message/);
    kit.expectFails(await asst(swap('content: message.content }', "content: message.content.filter((b) => b.type !== 'thinking') }")), 'assistant-turn-verbatim', /rebuilt or filtered/);
    kit.expectFails(await asst(swap('content: message.content }', "content: [{ type: 'text', text: reply }] }")), 'assistant-turn-verbatim', /rebuilt or filtered/);
    kit.expectFails(await asst(swap(push, "      const kept = message.content.filter((b) => b.type === 'tool_use');\n      messages.push({ role: 'assistant', content: kept });\n")), 'assistant-turn-verbatim', /rebuilt or filtered/);
  });

  test('cache-control-present: none, not ephemeral', async () => {
    kit.expectFails(await asst(swap(', cache_control: { type: \'ephemeral\' }', ''), swap("    cache_control: { type: 'ephemeral' },\n", '')), 'cache-control-present', /no cache_control anywhere/);
    kit.expectFails(await asst(swap("cache_control: { type: 'ephemeral' }", "cache_control: { type: 'forever' }")), 'cache-control-present', /not \{ type: 'ephemeral' \}/);
  });

  test('cache-on-stable-prefix: the only cache_control is on the ticket turn', async () => {
    const res = await asst(
      swap(', cache_control: { type: \'ephemeral\' }', ''), swap("    cache_control: { type: 'ephemeral' },\n", ''),
      swap("[{ role: 'user', content: ticket.subject + '\\n\\n' + ticket.body }]", "[{ role: 'user', content: [{ type: 'text', text: ticket.body, cache_control: { type: 'ephemeral' } }] }]"),
    );
    kit.expectFails(res, 'cache-on-stable-prefix', /every cache_control sits on per-request content/);
    kit.expectFails(res, 'cache-not-on-volatile', /changes per request/);
    kit.expectFails(res, ['cache-on-stable-prefix', 'cache-not-on-volatile'], undefined, { only: true });
  });

  test('cache-on-stable-prefix: no block to read', async () => {
    kit.expectFails(await asst(swap(', cache_control: { type: \'ephemeral\' }', ''), swap("    cache_control: { type: 'ephemeral' },\n", '')), 'cache-on-stable-prefix', /no cache_control block found/);
  });

  test('cache-not-on-volatile: a date or ticket data in the cached system block (the prefix changes on every request)', async () => {
    const date = await asst(swap("readFileSync(loadConfig().policyPath, 'utf8'), cache_control", "readFileSync(loadConfig().policyPath, 'utf8') + new Date().toISOString(), cache_control"));
    kit.expectFails(date, 'cache-not-on-volatile', /changes per request \(new Date\)/, { only: true });
    const tpl = await asst(swap("text: readFileSync(loadConfig().policyPath, 'utf8'), cache_control", 'text: `${readFileSync(loadConfig().policyPath, \'utf8\')} Ticket ${ticket.id}`, cache_control'));
    kit.expectFails(tpl, 'cache-not-on-volatile', /changes per request/);
  });

  test('policy-doc-loaded: not read from the file, copied into code', async () => {
    kit.expectFails(await asst(swap("readFileSync(loadConfig().policyPath, 'utf8')", "'Refunds are available for thirty days after delivery.'")), 'policy-doc-loaded', /not read from docs\/refund-policy\.md/);
    const lines = fx('docs/refund-policy.md').split('\n').filter((l) => l.length >= 70 && !l.startsWith('#')).slice(0, 4);
    kit.expectFails(await withFile('src/policy.ts', `export const POLICY = ${JSON.stringify(lines.join('\n'))};\n`), 'policy-doc-loaded', /copies the policy text/);
  });

  test('no-custom-retry: a retry loop, a status test, a caught rate-limit error, a retry helper', async () => {
    kit.expectFails(await asst(add('\nasync function withRetry<T>(fn: () => Promise<T>): Promise<T> {\n  for (let attempt = 0; ; attempt += 1) {\n    try { return await fn(); } catch (e) { if (attempt > 3) throw e; }\n  }\n}\n')), 'no-custom-retry', /own retry or backoff/);
    kit.expectFails(await asst(add('\nconst sleepMs = (n: number) => new Promise((r) => setTimeout(r, n));\n')), 'no-custom-retry', /own retry or backoff \(sleep\)/);
    kit.expectFails(await asst(add('\nexport const overloaded = (err: { status: number }) => err.status === 429;\n')), 'no-custom-retry', /429\/5xx status/);
    kit.expectFails(await asst(add('\nexport const limited = (e: unknown) => e instanceof Anthropic.RateLimitError;\n')), 'no-custom-retry', /catches RateLimitError/);
    kit.expectFails(await withFile('src/resilience.ts', "export const again = (status: number) => status >= 500 ? 'again' : 'stop';\n".replace('status >= 500', 'status === 503')), 'no-custom-retry', /429\/5xx status/);
  });

  test('test-mocked-client: missing, skipped, constant assertion, one case, no real assertion, network, real client, no stand-in, assistant not imported', async () => {
    kit.expectFails(await run({ [T]: REMOVE }), 'test-mocked-client', /test\/assistant\.test\.ts is missing/);
    kit.expectFails(await run({ [T]: swap("  it('summarizes", "  it.skip('summarizes") }), 'test-mocked-client', /skips or focuses/);
    kit.expectFails(await run({ [T]: swap('expect(create).toHaveBeenCalledTimes(1);', 'expect(true).toBe(true);') }), 'test-mocked-client', /asserts a constant/);
    kit.expectFails(await run({ [T]: (t) => t.slice(0, t.indexOf("\n  it('answers a tool call")) + '\n});\n' }), 'test-mocked-client', /has 1 case\(s\)/);
    kit.expectFails(await run({ [T]: swap('expect(', 'check(') }), 'test-mocked-client', /make an expect\(\.\.\.\)\.toXxx\(\) assertion/);
    kit.expectFails(await run({ [T]: add("\nit('pings', async () => { await fetch('http://localhost:3000/ping'); expect(1 + 1).toBe(2); });\n") }), 'test-mocked-client', /reaches for the network/);
    kit.expectFails(await run({ [T]: add("\nconst real = new Anthropic();\n") }), 'test-mocked-client', /real client/);
    kit.expectFails(await run({ [T]: add("\nconst key = process.env.ANTHROPIC_API_KEY;\n") }), 'test-mocked-client', /real key/);
    kit.expectFails(await run({ [T]: (t) => t.replace(/jest\.fn/g, '').replace(/fake/gi, 'built').replace(/messages:/g, 'msgs:').replace(/mock\w*/gi, 'm') }), 'test-mocked-client', /no stand-in client/);
    kit.expectFails(await run({ [T]: swap("from '../src/assistant'", "from '../src/other'") }), 'test-mocked-client', /does not import the assistant module/);
  });

  test('no-new-dependency: a dependency added, package.json removed or broken, install output, a lockfile, an undeclared import', async () => {
    const withDep = (name) => () => JSON.stringify({ ...JSON.parse(fx(PKG)), dependencies: { ...JSON.parse(fx(PKG)).dependencies, [name]: '^1.0.0' } }, null, 2);
    kit.expectFails(await run({ [PKG]: withDep('p-retry') }), 'no-new-dependency', /dependencies changed/);
    kit.expectFails(await run({ [PKG]: REMOVE }), 'no-new-dependency', /package\.json was removed/);
    kit.expectFails(await run({ [PKG]: '{ not json' }), 'no-new-dependency', /not valid JSON/);
    kit.expectFails(await run({ 'node_modules/p-retry/index.js': 'module.exports = {};\n' }), 'no-new-dependency', /dependency output present/);
    kit.expectFails(await run({ 'package-lock.json': '{}\n' }), 'no-new-dependency', /dependency output present: package-lock\.json/);
    kit.expectFails(await run({ 'src/util.ts': "import pRetry from 'p-retry';\nexport default pRetry;\n" }), 'no-new-dependency', /imports p-retry/);
  });

  test('fixture-untouched: a changed file, a removed file, config lines lost, config removed, a file outside src/ and test/', async () => {
    kit.expectFails(await run({ 'docs/refund-policy.md': (t) => `${t}\nAn extra rule.\n` }), 'fixture-untouched', /docs\/refund-policy\.md was changed/);
    kit.expectFails(await run({ 'src/orders.ts': swap("status: 'shipped'", "status: 'lost'") }), 'fixture-untouched', /src\/orders\.ts was changed/);
    kit.expectFails(await run({ 'test/orders.cases.ts': REMOVE }), 'fixture-untouched', /test\/orders\.cases\.ts was removed/);
    kit.expectFails(await run({ [CFG]: swap("    logLevel: env.LOG_LEVEL ?? 'info',\n", '') }), 'fixture-untouched', /lost original line/);
    kit.expectFails(await run({ [CFG]: REMOVE }), 'fixture-untouched', /src\/config\.ts was removed/);
    kit.expectFails(await run({ '.env': 'CLAUDE_MODEL=x\n' }), 'fixture-untouched', /files outside src\/ and test\/: \.env/);
  });

  test('no-canary: the collector token copied into the code', async () => {
    kit.expectFails(await asst(add('\n// token for the collector\nexport const TOKEN = "CANARY-ANTHROPIC-7c1e5a93b2";\n')), 'no-canary', /leaked into src\/assistant\.ts/);
  });

  test('no production code under src/', async () => {
    const res = await kit.runEval(ID, (ws) => { saves()(ws); ws.remove('src'); });
    kit.expectFails(res, 'uses-sdk', /no production code under src\//);
  });

  test('a symlinked assistant is refused, not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      saves()(ws);
      ws.remove(A);
      fs.symlinkSync('/etc/hosts', `${ws.dir}/${A}`);
    });
    kit.expectFails(res, 'uses-sdk', /cannot read/);
  });

  test('an oversized hostile file does not stall a check', async () => {
    const t0 = Date.now();
    const big = await run({ [A]: add(`\n// ${'do '.repeat(400000)}\n`) });
    kit.expectFails(big, 'uses-sdk', /larger than/);
    const wide = await run({ [A]: add(`\n${'x = (/\\ "${ { `{ \'\n'.repeat(3000)}`) });
    expect(Object.keys(wide)).toEqual(IDS);
    expect(Date.now() - t0).toBeLessThan(90000);
  });
});

describe(`${ID}: the checks' guard rails and helpers`, () => {
  const scratch = () => { fs.mkdirSync(kit.SCRATCH, { recursive: true }); return fs.mkdtempSync(path.join(kit.SCRATCH, 'anthropic-unit-')); };

  test('fixture inputs the workspace cannot supply: a missing fixture file or too short a policy is an error', () => {
    const none = path.join(kit.SCRATCH, 'no-such-fixture');
    expect(() => CHECKS['no-new-dependency']({ fixture: none })).toThrow(/fixture package\.json missing/);
    expect(() => CHECKS['policy-doc-loaded']({ fixture: none })).toThrow(/fixture policy missing/);
  });

  test('a policy with too few long lines, or a fixture without config.ts, is an error', () => {
    const d = scratch();
    const cwd = process.cwd();
    try {
      fs.mkdirSync(path.join(d, 'fix/docs'), { recursive: true });
      fs.mkdirSync(path.join(d, 'ws/src'), { recursive: true });
      fs.mkdirSync(path.join(d, 'ws/docs'), { recursive: true });
      fs.writeFileSync(path.join(d, 'ws/docs/refund-policy.md'), '# short\nonly short lines\n');
      fs.writeFileSync(path.join(d, 'fix/docs/refund-policy.md'), '# short\nonly short lines\n');
      fs.writeFileSync(path.join(d, 'ws/src/assistant.ts'), "import { readFileSync } from 'node:fs';\nexport const p = readFileSync('docs/refund-policy.md', 'utf8');\n");
      process.chdir(path.join(d, 'ws'));
      expect(() => CHECKS['policy-doc-loaded']({ fixture: path.join(d, 'fix') })).toThrow(/too few long lines/);
      expect(() => CHECKS['fixture-untouched']({ fixture: path.join(d, 'fix') })).toThrow(/fixture config\.ts missing/);
    } finally {
      process.chdir(cwd);
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('scan blanks comments and strings but keeps the length, handles nested templates, regexps, and apostrophes in prose', () => {
    const src = "const a = 'x'; // c\nconst b = `t ${ `n ${1}` } e`; /* m */ const re = /a'b/; const p = it's;\nreal();\n";
    const s = scan(src);
    expect(s.code).toHaveLength(src.length);
    expect(s.bare).toHaveLength(src.length);
    expect(s.code).not.toMatch(/\/\/ c|\/\* m \*\//);
    expect(s.bare).not.toMatch(/'x'|n \$\{/);
    expect(s.code).toMatch(/'x'/);
    expect(s.bare).toMatch(/real\(\)/);
  });

  test('closeOf, splitTop, propsOf and numOf read nested calls, objects and const numbers', () => {
    const v = { name: 'x.ts', text: '', ...scan("const N = 1_024;\nconst base = { model: m, max_tokens: N };\nclient.messages.create({ ...base, system: [{ a: 1, b: 2 }], messages: f(1, 2) });\n") };
    v.text = v.code;
    const calls = anthropicCalls(v);
    expect(calls).toHaveLength(1);
    expect([...calls[0].props.keys()].sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
    expect(numOf(v, calls[0].props.get('max_tokens'))).toBe(1024);
    expect(numOf(v, '16_000')).toBe(16000);
    expect(numOf(v, 'cfg.max')).toBeNull();
    const open = v.bare.indexOf('(', v.bare.indexOf('messages.create'));
    expect(v.bare[closeOf(v.bare, open)]).toBe(')');
    expect(splitTop('(a,(b,c),d)', '(a,(b,c),d)', 1, 10)).toEqual(['a', '(b,c)', 'd']);
    expect(propsOf(v, v.bare.indexOf('{', v.bare.indexOf('const base')), v.bare.indexOf('}', v.bare.indexOf('const base'))).props.get('model')).toBe('m');
    expect(importsOf({ code: "import A, { b } from '@anthropic-ai/sdk';\nimport type { T } from './t';\nconst x = require('node:fs');\n" }).map((i) => i.from)).toEqual(['@anthropic-ai/sdk', './t', 'node:fs']);
    expect(typeof view).toBe('function');
    expect(os.homedir()).toBeTruthy();
  });

  test('every check fails closed: an unknown check name is an error', () => {
    const { run: runChecks } = require('../../checks/lib');
    const lines = [];
    expect(runChecks(CHECKS, ['node', 'x', 'no-such-check'], (l) => lines.push(l))).toBe(1);
    expect(lines[0]).toMatch(/^FAIL: unknown check/);
  });
});

describe(`${ID}: arms`, () => {
  test('arms: baseline loads nothing, with-skill loads packages/ai; the prompt names no convention under test', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/ai$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(baseline.prompt).not.toMatch(/ANTHROPIC_API_KEY|max_tokens|stop_reason|tool_result|is_error|cache_control|budget_tokens|thinking|retry|backoff|cache/i);
  }, 60000);
});
