import { build, defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { checkAssets, copyAssets } from './scripts/copy-assets.mjs';

const clientRoot = fileURLToPath(new URL('./src/client', import.meta.url));
const outputDirectory = fileURLToPath(new URL('./public', import.meta.url));
const BUILD_TARGET = 'es2022';

/** Entries served before login (guards.ts PUBLIC_PATHS) keep their name; everything else gets a hash. */
const STABLE_ENTRIES = new Set(['login', 'pair']);

/**
 * One self-contained IIFE build of a classic script (no imports, so no shared chunk). `pair.js` needs this: the server
 * serves only `/pair.js` before login (guards.ts PUBLIC_PATHS), not the hashed `/assets/` chunks a module entry loads.
 */
async function buildClassicScript(entry: string, name: string, fileName: string): Promise<void> {
  await build({
    configFile: false,
    root: clientRoot,
    publicDir: false,
    logLevel: 'warn',
    plugins: [vue()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: outputDirectory,
      emptyOutDir: false,
      target: BUILD_TARGET,
      sourcemap: true,
      lib: { entry, formats: ['iife'], name, fileName: () => fileName },
    },
  });
}

/** The pairing page's script, built on its own (see buildClassicScript). */
function pairScript() {
  return {
    name: 'dashboard-pair-script',
    async writeBundle() {
      await buildClassicScript(`${clientRoot}/features/pair/pair.ts`, 'dashboardPair', 'pair.js');
    },
  };
}

/** Copies fonts and skin artwork into the output folder after Vite has emptied it; fails on a bad SVG. */
function skinAssets() {
  return {
    name: 'dashboard-skin-assets',
    buildStart() {
      checkAssets();
    },
    writeBundle() {
      copyAssets();
    },
  };
}

/**
 * The pre-paint boot script loads as a classic script from <head>, so it is its own self-contained build
 * (an IIFE with no imports) instead of an entry of the main build, which would share chunks with the app.
 */
function bootScript() {
  return {
    name: 'dashboard-boot-script',
    async writeBundle() {
      await buildClassicScript(`${clientRoot}/app/boot.ts`, 'dashboardBoot', 'boot.js');
    },
  };
}

/**
 * The login page is served before login, when only the files in PUBLIC_PATHS (guards.ts) are reachable, so
 * `login.js` must not import a shared chunk from `assets/`. It is its own build, with Vue bundled inside, and its stylesheet is written as `style.css` (also public).
 */
function loginPage() {
  return {
    name: 'dashboard-login-page',
    async writeBundle() {
      await build({
        configFile: false,
        root: clientRoot,
        publicDir: false,
        logLevel: 'warn',
        plugins: [vue()],
        build: {
          outDir: outputDirectory,
          emptyOutDir: false,
          target: BUILD_TARGET,
          sourcemap: true,
          modulePreload: { polyfill: false },
          rollupOptions: {
            input: { login: `${clientRoot}/login.html` },
            output: {
              entryFileNames: '[name].js',
              assetFileNames: (asset) => (asset.names.some((name) => name.endsWith('.css')) ? 'style.css' : 'assets/[name]-[hash][extname]'),
            },
          },
        },
      });
    },
  };
}

export default defineConfig({
  root: clientRoot,
  base: '/',
  publicDir: false,
  plugins: [vue(), skinAssets(), bootScript(), pairScript(), loginPage()],
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    target: BUILD_TARGET,
    sourcemap: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: `${clientRoot}/index.html`,
        pair: `${clientRoot}/pair.html`,
      },
      output: {
        entryFileNames: (chunk) => (STABLE_ENTRIES.has(chunk.name) ? '[name].js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (asset) => (asset.names.some((name) => name.endsWith('.css')) ? '[name][extname]' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
});
