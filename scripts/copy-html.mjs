import { copyFileSync, mkdirSync } from 'node:fs';
import { copyAssets } from './copy-assets.mjs';

mkdirSync('public', { recursive: true });
for (const f of ['index.html', 'login.html']) copyFileSync(`src/client/${f}`, `public/${f}`);
copyAssets();
