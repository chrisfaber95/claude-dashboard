import { cpSync, existsSync, lstatSync } from 'node:fs';
import { extname } from 'node:path';

const ALLOWED = new Set(['.woff2', '.txt']);

/** Copies the self-hosted skin fonts (the CSP only allows same-origin fonts) to public/fonts. */
export function copyFonts() {
  if (!existsSync('src/client/fonts')) return;
  cpSync('src/client/fonts', 'public/fonts', {
    recursive: true,
    // Everything in public/ is served: skip symlinks and copy only font and licence files.
    filter: (src) => {
      const st = lstatSync(src);
      if (st.isSymbolicLink()) return false;
      return st.isDirectory() || ALLOWED.has(extname(src).toLowerCase());
    },
  });
}
