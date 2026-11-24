'use strict';

/**
 * A fixture legacy CLI that terminates its own process, the way the real legacy CLIs do
 * (`trd-cli.js` and `toolchain-cli.js` end with `process.exit(code)`).
 *
 * The engine mounts a legacy CLI as a child process, so this fixture's exit has to surface as
 * an exit code without ever terminating the engine process itself.
 */
process.exit(2);
