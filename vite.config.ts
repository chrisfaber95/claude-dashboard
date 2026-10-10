import { build, defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { checkAssets, copyAssets } from './scripts/copy-assets.mjs';

const clientRoot = fileURLToPath(new URL('./src/client', import.meta.url));
const outputDirectory = fileURLToPath(new URL('./public', import.meta.url));
const BUILD_TARGET = 'es2022';

/** Entries served before login (guards.ts PUBLIC_PATHS) keep their name; everything else gets a hash. */
const STABLE_ENTRIES = new Set(['login', 'pair']);

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
      await build({
        configFile: false,
        root: clientRoot,
        publicDir: false,
        logLevel: 'warn',
        build: {
          outDir: outputDirectory,
          emptyOutDir: false,
          target: BUILD_TARGET,
          sourcemap: true,
          lib: { entry: `${clientRoot}/app/boot.ts`, formats: ['iife'], name: 'dashboardBoot', fileName: () => 'boot.js' },
        },
      });
    },
  };
}

export default defineConfig({
  root: clientRoot,
  base: '/',
  publicDir: false,
  plugins: [vue(), skinAssets(), bootScript()],
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    target: BUILD_TARGET,
    sourcemap: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: `${clientRoot}/index.html`,
        login: `${clientRoot}/login.html`,
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
