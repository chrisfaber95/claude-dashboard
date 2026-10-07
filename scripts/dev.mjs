// Dev mode: rebuild the client on change and restart the server on server-side changes.
// Usage: node scripts/dev.mjs [--lan]. Refresh the browser tab after a client rebuild.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, watch } from 'node:fs';
import { context } from 'esbuild';
import { copyAssets } from './copy-assets.mjs';

const serverArgs = process.argv.slice(2);

mkdirSync('public', { recursive: true });
const copyHtml = () => {
  for (const f of ['index.html', 'login.html']) copyFileSync(`src/client/${f}`, `public/${f}`);
};
copyHtml();
// Fonts and skin artwork rarely change, so copy them once at startup.
copyAssets();
watch('src/client', (_event, name) => {
  if (name === 'index.html' || name === 'login.html') copyHtml();
});

const js = await context({
  entryPoints: ['src/client/app.ts', 'src/client/login.ts', 'src/client/boot.ts'],
  bundle: true,
  outdir: 'public',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
});
await js.watch();

const children = [
  spawn(process.execPath, ['node_modules/sass/sass.js', '--no-source-map', '--watch', 'src/client/style.scss', 'public/style.css'], { stdio: 'inherit' }),
  // --watch-path limits restarts to server and shared code; client rebuilds don't restart it.
  spawn(
    process.execPath,
    ['--watch-path=src/server', '--watch-path=src/shared', 'src/server/server.ts', ...serverArgs],
    { stdio: 'inherit' },
  ),
];

const stop = () => {
  for (const c of children) c.kill();
  void js.dispose().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
