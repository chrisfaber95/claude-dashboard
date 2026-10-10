import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { checkSvg } from './svg-guard.mjs';

// Static skin assets (the CSP only allows same-origin fonts and images). Everything copied to public/ is served,
// so each folder has an extension allowlist, symlinks are skipped and SVGs must pass the allowlist check.
const ASSETS = [
  { from: 'src/client/fonts', to: 'public/fonts', allowed: new Set(['.woff2', '.txt']) },
  { from: 'src/client/skins/root', to: 'public/root', allowed: new Set(['.svg']) },
];

/** Every regular file under dir that would be copied (symlinks skipped, as in the copy). */
function filesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...filesIn(p));
    else out.push(p);
  }
  return out;
}

/** Copies the self-hosted skin assets (fonts, Root skin artwork) into public/. Throws if an SVG fails the check. */
export function copyAssets() {
  // Check every SVG before touching public/, so a bad file fails the build without leaving a half-copied folder.
  const problems = [];
  for (const { from } of ASSETS) {
    if (!existsSync(from) || lstatSync(from).isSymbolicLink()) continue;
    for (const file of filesIn(from)) {
      if (extname(file).toLowerCase() !== '.svg') continue;
      const found = checkSvg(readFileSync(file, 'utf8'));
      if (found.length) problems.push(`${file} failed the SVG check:\n  ${found.join('\n  ')}`);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));

  for (const { from, to, allowed } of ASSETS) {
    // Start clean so a file deleted from src/ is not served from a stale copy.
    rmSync(to, { recursive: true, force: true, maxRetries: 3 });
    if (!existsSync(from)) continue;
    cpSync(from, to, {
      recursive: true,
      filter: (src) => {
        const st = lstatSync(src);
        if (st.isSymbolicLink()) return false;
        return st.isDirectory() || allowed.has(extname(src).toLowerCase());
      },
    });
  }
}
