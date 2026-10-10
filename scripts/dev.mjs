// Dev mode: rebuild the client on change (Vite build in watch mode) and restart the server on server-side changes.
// Usage: node scripts/dev.mjs [--lan]. Refresh the browser tab after a client rebuild.
import { spawn } from 'node:child_process';
import { build } from 'vite';

const serverArgs = process.argv.slice(2);

// Uses vite.config.ts; the watcher rebuilds pages, scripts, styles, and skin assets on every change.
const watcher = await build({ build: { watch: {}, emptyOutDir: true } });

// --watch-path limits restarts to server and shared code; client rebuilds don't restart it.
const server = spawn(
  process.execPath,
  ['--watch-path=src/server', '--watch-path=src/shared', 'src/server/server.ts', ...serverArgs],
  { stdio: 'inherit' },
);

const stop = () => {
  server.kill();
  void Promise.resolve(watcher.close?.()).finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
