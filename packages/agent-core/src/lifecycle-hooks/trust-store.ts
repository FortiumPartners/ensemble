/**
 * The user's trust in a project's lifecycle hooks (TRD-019, REQ-022,
 * AC-022-5 to AC-022-8).
 *
 * The host reports a project as trusted by default, so a cloned repository
 * could run its hooks at the first command unless the user has also trusted
 * the hooks explicitly. That decision is a record in a store under the user's
 * home directory, never inside the repository, holding a digest of everything
 * the hooks would run. A change to any of it makes the record stale, and a
 * stale record is no record.
 *
 * What the digest covers (AC-022-6):
 * - the hooks file, `.ensemble/hooks.yaml`, as raw bytes. It carries every
 *   handler's name, type, arguments, timeout and `on_error`, and each
 *   command's selection;
 * - every file the configuration names by path, resolved against the project
 *   root as the shell and prompt runners resolve them: a shell handler's
 *   `command` when it contains a slash (the shell runner's own rule for
 *   telling a file from a PATH lookup) and each prompt handler's `prompt`
 *   file. A named file outside the project counts too; the TRD asks only for
 *   files inside it;
 * - every entry of a shell handler's `args` that, resolved against the project
 *   root, is an existing regular file (symlinks followed). With
 *   `command: node` and `args: [./hooks/audit.js]` the script is the code that
 *   runs, so editing it voids trust. Any other entry (a flag, a plain word, a
 *   directory, a device or pipe, a path that does not exist) adds nothing, and
 *   nothing inside a directory is looked at. Only a whole entry counts:
 *   `--config=./x.json` is a flag, not a path. A file that appears later at a
 *   path an entry already names changes the digest, and so does a file a
 *   handler rewrites itself, so a handler cannot stay trusted while it writes
 *   a file named in its own `args`.
 *
 * Each file is identified by its path relative to the project root, or its
 * absolute path when it lies outside, and a SHA-256 of its bytes. A command or
 * prompt file that cannot be read as a regular file (missing, a directory, a
 * pipe, no permission), and an argument file that is regular but cannot be
 * read, contribute the marker `unreadable` instead, so computing a digest
 * never throws and never waits on a pipe. The entries are sorted by identity
 * and hashed as one JSON document, so no file name can pass as the boundary
 * between two entries.
 *
 * What the digest does not cover, and so what a confirmation cannot vouch for:
 * - a bare command name such as `node`: it is a PATH lookup and cannot be
 *   hashed (the name itself is covered, as text in the hooks file);
 * - a file that only a covered file calls or reads, and a path inside an
 *   argument that is not the whole argument (`--config=./x.json`);
 * - the files as they are when the handler runs: they can change between the
 *   check and the run.
 *
 * The store is a JSON file, `~/.ensemble/trusted-hooks.json` by default:
 *
 *   { "version": 1, "projects": { "<real path>": { "digest": "sha256:...", "trusted_at": "<ISO 8601>" } } }
 *
 * Records are keyed by the project's real path, so a symlink to a project
 * finds the project's record. The store is written atomically and owner-only.
 * Its path comes only from the caller or the home directory, never from the
 * project, and a store path inside the project is refused: `isTrusted` says no
 * without reading it and `recordTrust` throws (AC-022-7). So a project that
 * contains the store, such as one rooted at the home directory itself, can
 * never be trusted.
 */

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isRecord } from "../type-guards";
import { HOOKS_FILE_RELATIVE } from "./config";
import type { HooksConfig } from "./types";

/** Format of the store file. A store of any other version is unusable. */
const STORE_VERSION = 1;

/** Names the digest format, so a later change to it cannot produce a digest of this one. */
const DIGEST_DOMAIN = "ensemble-lifecycle-hooks-trust/v1";

/** Stands in for the content hash of a file that cannot be read as a regular file. */
const UNREADABLE = "unreadable";

/** Bytes read per step when hashing, so a file is never held in memory whole. */
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * A token shown as written: it has no whitespace, quote, backslash, list
 * delimiter or control or format character that could blur where it ends.
 */
const PLAIN_TOKEN = /^[^\s"\\,[\]\p{C}]+$/u;

/** What a quoted token escapes: every invisible or line-breaking character except the plain space. */
const INVISIBLE = /[\p{C}\p{Z}]/gu;

interface TrustEntry {
  digest: string;
  trusted_at: string;
}

/** The store's records, by the real path of the project. */
type TrustRecords = Map<string, TrustEntry>;

export interface TrustCheckOptions {
  /** The trust store file. Defaults to `defaultTrustStorePath()`. Never taken from the project; a path inside the project is refused. */
  storePath?: string;
}

export interface RecordTrustOptions extends TrustCheckOptions {
  /** Clock for `trusted_at`; injected so tests are deterministic. */
  now?: () => Date;
}

/** `<home>/.ensemble/trusted-hooks.json`; `homeDir` defaults to the current user's home directory. */
export function defaultTrustStorePath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".ensemble", "trusted-hooks.json");
}

/** `target` relative to `base` with `/` separators, or undefined when `target` lies outside `base`. */
function relativeWithin(base: string, target: string): string | undefined {
  const relative = path.relative(base, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

/** SHA-256 of a regular file's bytes, as hex; `UNREADABLE` for anything else and for any read error. */
function hashFile(file: string): string {
  let fd: number | undefined;
  try {
    // O_NONBLOCK keeps open() from waiting for a writer when the path is a pipe.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) return UNREADABLE;
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      hash.update(chunk.subarray(0, read));
    }
    return hash.digest("hex");
  } catch {
    return UNREADABLE;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** True when `file` exists and is a regular file once symlinks are followed. */
function isRegularFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The digest of a project's hooks: the hooks file, every file the
 * configuration names by path and every shell argument that is an existing
 * regular file, as described at the top of this module.
 * Returns `sha256:<hex>`. Never throws for a file it cannot read.
 */
export function computeHooksDigest(projectRoot: string, config: HooksConfig): string {
  const root = path.resolve(projectRoot);
  const named = [path.resolve(root, HOOKS_FILE_RELATIVE)];
  for (const handler of Object.values(config.hooks)) {
    if (handler.type === "prompt") {
      named.push(path.resolve(root, handler.prompt));
    } else {
      if (handler.command.includes("/")) named.push(path.resolve(root, handler.command));
      for (const arg of handler.args) {
        const file = path.resolve(root, arg);
        if (isRegularFile(file)) named.push(file);
      }
    }
  }

  const hashes = new Map<string, string>();
  for (const file of named) {
    const identity = relativeWithin(root, file) ?? file;
    if (!hashes.has(identity)) hashes.set(identity, hashFile(file));
  }
  const entries = [...hashes].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return `sha256:${createHash("sha256").update(JSON.stringify([DIGEST_DOMAIN, entries])).digest("hex")}`;
}

/**
 * Real path of `target`: symlinks are resolved in the part that exists, and
 * the part that does not exist yet is kept as written. `target` must be absolute.
 */
function realPathAllowingMissing(target: string): string {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = path.dirname(current);
      if ((code !== "ENOENT" && code !== "ENOTDIR") || parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Where a project's record lives: the project's real path, which keys the
 * record, and the store file's absolute path. Throws when the store lies
 * inside the project, where the repository could have written it (AC-022-7),
 * and when the project does not exist.
 */
function locateStore(projectRoot: string, options: TrustCheckOptions): { project: string; storePath: string } {
  const storePath = path.resolve(options.storePath ?? defaultTrustStorePath());
  const project = fs.realpathSync(projectRoot);
  if (relativeWithin(project, realPathAllowingMissing(storePath)) !== undefined) {
    throw new Error(
      `The trust store must be outside the repository: ${storePath} lies inside ${project}, ` +
        "and a repository could ship a file at that path to grant itself trust.",
    );
  }
  return { project, storePath };
}

/**
 * Read the store's records. Returns undefined when the store is missing,
 * unreadable, not JSON or not a version-1 store; entries of the wrong shape
 * are left out.
 */
function readTrustRecords(storePath: string): TrustRecords | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.version !== STORE_VERSION || !isRecord(parsed.projects)) return undefined;

  const records: TrustRecords = new Map();
  for (const [project, entry] of Object.entries(parsed.projects)) {
    if (isRecord(entry) && typeof entry.digest === "string" && typeof entry.trusted_at === "string") {
      records.set(project, { digest: entry.digest, trusted_at: entry.trusted_at });
    }
  }
  return records;
}

/**
 * Write the store atomically: a temporary file in the same directory, flushed,
 * then renamed over the store. The directory is created owner-only when it
 * does not exist and the file is owner-only. A failed write removes its
 * temporary file and leaves the previous store as it was.
 */
function writeTrustRecords(storePath: string, records: TrustRecords): void {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `.${path.basename(storePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const body = `${JSON.stringify({ version: STORE_VERSION, projects: Object.fromEntries(records) }, null, 2)}\n`;

  // "wx" fails on any existing path, symlink included, so nothing is written through one.
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, body);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, storePath);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * Record that the user trusts `digest` for the project at `projectRoot`,
 * replacing the project's earlier record and keeping the others. Call it only
 * after the user has confirmed (AC-022-8). A store that is corrupted is
 * treated as empty and rewritten.
 *
 * Throws when the store lies inside the project (AC-022-7), when the project
 * does not exist, and when the store cannot be written.
 */
export function recordTrust(projectRoot: string, digest: string, options: RecordTrustOptions = {}): void {
  const { project, storePath } = locateStore(projectRoot, options);
  const records: TrustRecords = readTrustRecords(storePath) ?? new Map();
  records.set(project, { digest, trusted_at: (options.now?.() ?? new Date()).toISOString() });
  writeTrustRecords(storePath, records);
}

/**
 * True only when the store holds a record for the project's real path whose
 * digest equals `digest`. Everything else is false and nothing throws: no
 * store, an unreadable or corrupted one, a store of another version, an entry
 * of the wrong shape, an unknown project, a project that does not exist, and a
 * store that lies inside the project (which is then not read at all).
 */
export function isTrusted(projectRoot: string, digest: string, options: TrustCheckOptions = {}): boolean {
  try {
    const { project, storePath } = locateStore(projectRoot, options);
    const record = readTrustRecords(storePath)?.get(project);
    // Not `record?.digest === digest`: with no record and no digest that is `undefined === undefined`.
    return record !== undefined && record.digest === digest;
  } catch {
    return false;
  }
}

/**
 * `text` as one token of a confirmation line. A token that is plain is shown
 * as written. Any other (empty, or holding whitespace, a quote, a backslash,
 * a comma, a bracket or a control or format character) is shown in double
 * quotes with those characters escaped, so it stays one visible token and
 * cannot break the line, move the cursor or hide the text around it.
 */
function showToken(text: string): string {
  if (PLAIN_TOKEN.test(text)) return text;
  return JSON.stringify(text).replace(INVISIBLE, (ch) =>
    ch === " " ? ch : `\\u{${ch.codePointAt(0)?.toString(16)}}`,
  );
}

/**
 * The lines of the trust confirmation (AC-022-8): one per handler, in the
 * order configured, with its exact executable and arguments or its prompt
 * file, then one per command selection naming the handlers it runs at start
 * and at end. Whitespace-bearing and other unsafe tokens are quoted and
 * escaped (see `showToken`), so every handler is exactly one line.
 *
 *   shell audit: ./scripts/audit.sh arg1 "two words" (timeout 5000ms, on_error continue)
 *   prompt review: ./prompts/review.md (timeout 30000ms, on_error continue)
 *   command ensemble:create-prd: start [audit], end [review, audit]
 */
export function describeHooksForTrust(config: HooksConfig): string[] {
  const lines: string[] = [];
  for (const [name, handler] of Object.entries(config.hooks)) {
    const what =
      handler.type === "shell" ? [handler.command, ...handler.args].map(showToken).join(" ") : showToken(handler.prompt);
    const limits = `timeout ${handler.timeout_ms}ms, on_error ${handler.on_error}`;
    lines.push(`${handler.type} ${showToken(name)}: ${what} (${limits})`);
  }
  for (const [command, selection] of Object.entries(config.commands)) {
    const start = selection.start.map(showToken).join(", ");
    const end = selection.end.map(showToken).join(", ");
    lines.push(`command ${showToken(command)}: start [${start}], end [${end}]`);
  }
  return lines;
}
